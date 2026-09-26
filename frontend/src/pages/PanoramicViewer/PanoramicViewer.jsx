/**
 * SmartNav360 — Panoramic Viewer Page
 * Generates a QR code linking to a phone capture session, shows photos as
 * they arrive, then stitches them into one panorama with OpenCV.js.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Image, Progress, Table } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { CameraOutlined, CopyOutlined, MergeCellsOutlined, ReloadOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import PanoramaService from '../../services/panorama.service';
import UploadService from '../../services/upload.service';
import { stitchEquirectangular } from '../../utils/stitchEquirectangular';
import { getImageUrl } from '../../utils/getImageUrl';
import { API_BASE_URL, API_BASE_IS_SHAREABLE } from '../../constants/api';
import { ROUTES } from '../../constants/routes';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import EmptyState from '../../components/common/EmptyState';
import './PanoramicViewer.css';

const POLL_INTERVAL_MS = 2500;

const STAGE_LABELS = {
  'loading-photo': 'Loading photos…',
  'loading-model': 'Loading the feature-matching model…',
  features: 'Finding image features…',
  matching: 'Matching overlapping frames…',
  calibrating: 'Estimating the camera field of view…',
  aligning: 'Refining frame alignment…',
  'loop-closure': 'Closing the full turn…',
  projecting: 'Projecting onto the panorama…',
  blending: 'Blending seams…',
  done: 'Done.',
};

/** Builds the one-line summary shown after a stitch finishes. */
function describeStitch(report) {
  const parts = [`${report.frameCount} frames`];
  if (typeof report.hfovDeg === 'number') {
    parts.push(
      `${report.hfovDeg.toFixed(1)}° horizontal FOV${report.focalRefined ? ' (measured from the photos)' : ' (estimated)'}`
    );
  }
  const registered = report.pairs.filter((pair) => pair.source === 'image').length;
  parts.push(`${registered}/${report.pairs.length} pairs aligned on image features`);
  if (report.matcherCounts?.orb > 0 && report.matcher === 'xfeat') {
    parts.push(`${report.matcherCounts.orb} rescued by the ORB fallback`);
  }
  if (report.loopClosureDeg) parts.push(`loop closure ${report.loopClosureDeg.toFixed(1)}° spread across the turn`);
  return parts.join(' · ');
}

const PAIR_COLUMNS = [
  { title: 'Pair', dataIndex: 'pair', key: 'pair' },
  {
    title: 'Aligned by',
    dataIndex: 'source',
    key: 'source',
    render: (source) => (source === 'image' ? 'image features' : 'sensors only'),
  },
  {
    title: 'Matcher',
    dataIndex: 'matcher',
    key: 'matcher',
    render: (matcher) => (matcher === 'xfeat' ? 'XFeat' : matcher === 'orb' ? 'ORB' : '—'),
  },
  { title: 'Ratio matches', dataIndex: 'descriptorMatches', key: 'descriptorMatches' },
  { title: 'In overlap', dataIndex: 'consideredMatches', key: 'consideredMatches' },
  { title: 'RANSAC inliers', dataIndex: 'inliers', key: 'inliers' },
  {
    title: 'Residual',
    dataIndex: 'medianErrorDeg',
    key: 'medianErrorDeg',
    render: (value) => (typeof value === 'number' ? `${value.toFixed(2)}°` : '—'),
  },
  {
    title: 'Vs sensors',
    dataIndex: 'disagreementDeg',
    key: 'disagreementDeg',
    render: (value) => (typeof value === 'number' ? `${value.toFixed(1)}°` : '—'),
  },
  { title: 'Fallback reason', dataIndex: 'reason', key: 'reason', render: (value) => value || '—' },
];

/**
 * Registration diagnostics.
 *
 * A stitch that quietly falls back to sensor placement still produces an
 * image, so "it looks better" is not evidence that registration worked. These
 * counts are what separates "the frames barely overlap" from "they overlap but
 * the geometry model is wrong", and they stay on screen rather than passing by
 * in a notification.
 */
function StitchDetails({ report }) {
  if (!report) return null;
  const frame = report.frames?.[0];
  return (
    <Collapse
      ghost
      className="panoramic-viewer__details"
      items={[
        {
          key: 'registration',
          label: 'Registration details',
          children: (
            <div className="panoramic-viewer__details-body">
              {report.notes?.map((note) => (
                <Alert key={note} type="warning" showIcon message={note} />
              ))}

              <Descriptions size="small" column={1} bordered>
                {frame && (
                  <Descriptions.Item label="Frame size">
                    {frame.width} × {frame.height} px · aspect {frame.aspect.toFixed(3)}{' '}
                    {frame.aspect > 0.72 && frame.aspect < 0.78 ? '(full 4:3 sensor frame)' : '(not 4:3 — cropped)'}
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Horizontal FOV">
                  {report.hfovDeg?.toFixed(1)}° {report.focalRefined ? 'measured from the photos' : 'estimated, not measured'}
                  {report.focalRefined && typeof report.initialHfovDeg === 'number'
                    ? ` (started from ${report.initialHfovDeg.toFixed(1)}°)`
                    : ''}
                </Descriptions.Item>
                <Descriptions.Item label="Vertical FOV">{report.vfovDeg?.toFixed(1)}°</Descriptions.Item>
                {report.focalReason && (
                  <Descriptions.Item label="Calibration">
                    {report.focalReason}
                    {typeof report.focalScale === 'number' && report.focalRefined
                      ? ` · ${report.focalScale.toFixed(2)}× the expected focal length`
                      : ''}
                  </Descriptions.Item>
                )}
                {typeof report.medianYawStepDeg === 'number' && (
                  <Descriptions.Item label="Capture spacing">
                    {report.medianYawStepDeg.toFixed(1)}° between frames · about{' '}
                    {Math.max(0, report.overlapDeg).toFixed(1)}° of overlap
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Keypoints per frame">
                  {report.frames?.map((f) => f.keypoints).join(', ')}
                </Descriptions.Item>
                {report.loopClosureDeg !== null && (
                  <Descriptions.Item label="Loop closure">{report.loopClosureDeg?.toFixed(2)}°</Descriptions.Item>
                )}
              </Descriptions>

              <Table
                size="small"
                pagination={false}
                rowKey="pair"
                columns={PAIR_COLUMNS}
                dataSource={report.pairs}
              />
            </div>
          ),
        },
      ]}
    />
  );
}

export default function PanoramicViewer() {
  useDocumentTitle('Panoramic Viewer');

  const { currentProject } = useProject();
  const { success, error } = useNotification();

  const [token, setToken] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [stitching, setStitching] = useState(false);
  const [stitchStage, setStitchStage] = useState(null);
  const [stitchPercent, setStitchPercent] = useState(0);
  const [stitchDetail, setStitchDetail] = useState(null);
  const [stitchReport, setStitchReport] = useState(null);
  const [resultPreview, setResultPreview] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!token) return undefined;
    const poll = async () => {
      try {
        const result = await PanoramaService.getSession(token);
        if (result.success) {
          setPhotos(result.data.photos || []);
          setSessionStatus(result.data.status);
        }
      } catch {
        // Transient network errors shouldn't stop the poll loop.
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [token]);

  // Embed the backend API base whenever it is reachable from another device.
  // API_BASE_URL follows the host this page was served from, so opening the
  // desktop app at http://<lan-ip>:5173 makes the QR self-configuring on any
  // laptop, Wi-Fi network or phone hotspot. A loopback address is meaningless
  // to a phone, so it is omitted and the mobile app falls back to its own
  // configured server address. The browser capture page ignores ?api= either
  // way, so the existing fallback flow is unaffected.
  const captureUrl = token
    ? (() => {
        const base = `${window.location.origin}${ROUTES.PANORAMA_CAPTURE}/${token}`;
        if (!API_BASE_IS_SHAREABLE) return base;
        return `${base}?api=${encodeURIComponent(API_BASE_URL)}`;
      })()
    : null;

  const startSession = async () => {
    setStarting(true);
    setResultPreview(null);
    setStitchReport(null);
    try {
      const result = await PanoramaService.createSession(currentProject._id);
      if (result.success) {
        setToken(result.data.token);
        setPhotos([]);
        setSessionStatus(result.data.status);
      }
    } catch (err) {
      error('Could not start a capture session', err.message);
    } finally {
      setStarting(false);
    }
  };

  const copyLink = async () => {
    if (!captureUrl) return;
    try {
      await navigator.clipboard.writeText(captureUrl);
      success('Link copied');
    } catch {
      error('Could not copy the link', 'Copy it manually from the QR code page.');
    }
  };

  const stitch = async () => {
    setStitching(true);
    setStitchPercent(0);
    try {
      // Sort by capture sequence when known (native app frames), otherwise
      // fall back to arrival order — same assumption the browser flow relies
      // on today (photos taken in order while panning).
      const ordered = photos
        .slice()
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || new Date(a.uploadedAt) - new Date(b.uploadedAt));
      const { blob, report } = await stitchEquirectangular(
        ordered.map((photo) => ({
          url: getImageUrl(photo.path),
          yawDeg: photo.yaw,
          pitchDeg: photo.pitch,
          rollDeg: photo.roll,
        })),
        (info) => {
          setStitchStage(info.stage);
          setStitchDetail(info.detail || (info.total ? `${info.index} of ${info.total}` : null));
          if (typeof info.percent === 'number') setStitchPercent(info.percent);
        }
      );
      setStitchReport(report);
      const file = new File([blob], 'panorama.jpg', { type: 'image/jpeg' });
      const uploadResult = await UploadService.uploadImage(file, currentProject._id);
      if (uploadResult.success) {
        setResultPreview(getImageUrl(uploadResult.data.path));
        success('Panorama saved', 'It is now available as an asset — add it to a scene in Scene Builder.');
      }
      // Sensor-only pairs are the ones most likely to still ghost, so they are
      // named rather than buried — retaking those directions is the fix.
      if (report.fallbackPairs.length > 0) {
        error(
          'Some frames could not be aligned on image content',
          `${report.fallbackPairs.join('; ')}. Those frames were placed using the phone's motion sensors only.`
        );
      }
    } catch (err) {
      error('Could not stitch these photos', err.message);
    } finally {
      setStitching(false);
      setStitchStage(null);
      setStitchDetail(null);
    }
  };

  if (!currentProject) {
    return <Empty description="Choose a project to capture a panorama." />;
  }

  return (
    <div className="panoramic-viewer">
      <WorkspaceHeader
        title="Panoramic Viewer"
        description="Scan the QR code with your phone, capture a few overlapping photos, then stitch them into one panorama."
        actions={
          token ? (
            <Button icon={<ReloadOutlined />} onClick={startSession} loading={starting}>
              New session
            </Button>
          ) : (
            <Button type="primary" icon={<CameraOutlined />} loading={starting} onClick={startSession}>
              Start capture session
            </Button>
          )
        }
      />

      {!token ? (
        <Card>
          <EmptyState
            icon={CameraOutlined}
            title="No active capture session"
            description="Start a session to generate a QR code your phone can scan."
          />
        </Card>
      ) : (
        <div className="panoramic-viewer__grid">
          <Card title="Scan to capture" className="panoramic-viewer__qr-card">
            <div className="panoramic-viewer__qr">
              <QRCodeSVG value={captureUrl} size={200} />
            </div>
            <Button block icon={<CopyOutlined />} onClick={copyLink} className="panoramic-viewer__copy">
              Copy link
            </Button>
            <p className="panoramic-viewer__hint">
              {sessionStatus === 'done'
                ? 'The phone marked this session as done.'
                : 'Waiting for photos — this page updates automatically.'}
            </p>
            {!API_BASE_IS_SHAREABLE && (
              <p className="panoramic-viewer__hint">
                This page is open on localhost, so the QR code cannot tell a phone where the backend is. Open SmartNav
                at your computer&apos;s network address (for example http://192.168.1.20:5173) so phones can connect
                without extra setup.
              </p>
            )}
          </Card>

          <Card
            title={`Captured photos (${photos.length})`}
            className="panoramic-viewer__photos-card"
            extra={
              <Button
                type="primary"
                icon={<MergeCellsOutlined />}
                disabled={photos.length < 2}
                loading={stitching}
                onClick={stitch}
              >
                Stitch panorama
              </Button>
            }
          >
            {stitching && (
              <div className="panoramic-viewer__progress">
                <Progress percent={stitchStage === 'done' ? 100 : stitchPercent} showInfo={false} status="active" />
                <span>
                  {STAGE_LABELS[stitchStage] || 'Working…'}
                  {stitchDetail ? ` (${stitchDetail})` : ''}
                </span>
              </div>
            )}

            {photos.length === 0 ? (
              <EmptyState
                icon={CameraOutlined}
                title="No photos yet"
                description="Photos captured on the phone will appear here as they upload."
              />
            ) : (
              <div className="panoramic-viewer__thumbs">
                {photos.map((photo) => (
                  <Image key={photo._id} src={getImageUrl(photo.path)} className="panoramic-viewer__thumb" />
                ))}
              </div>
            )}

            {resultPreview && (
              <div className="panoramic-viewer__result">
                <h4>Stitched panorama</h4>
                <Image src={resultPreview} className="panoramic-viewer__result-image" />
                {stitchReport && <p className="panoramic-viewer__hint">{describeStitch(stitchReport)}</p>}
              </div>
            )}

            <StitchDetails report={stitchReport} />
          </Card>
        </div>
      )}
    </div>
  );
}
