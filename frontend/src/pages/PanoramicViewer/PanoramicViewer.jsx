/**
 * SmartNav360 — Panoramic Viewer Page
 * Generates a QR code linking to a phone capture session, shows photos as
 * they arrive, then stitches them into one panorama with OpenCV.js.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Empty, Image, Progress } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { CameraOutlined, CopyOutlined, MergeCellsOutlined, ReloadOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import PanoramaService from '../../services/panorama.service';
import UploadService from '../../services/upload.service';
import { stitchImages } from '../../utils/stitchPanorama';
import { getImageUrl } from '../../utils/getImageUrl';
import { ROUTES } from '../../constants/routes';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import EmptyState from '../../components/common/EmptyState';
import './PanoramicViewer.css';

const POLL_INTERVAL_MS = 2500;

const STAGE_LABELS = {
  'loading-library': 'Loading the stitching engine…',
  'loading-photo': 'Loading photos…',
  stitching: 'Stitching photos into a panorama…',
  done: 'Done.',
};

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

  const captureUrl = token ? `${window.location.origin}${ROUTES.PANORAMA_CAPTURE}/${token}` : null;

  const startSession = async () => {
    setStarting(true);
    setResultPreview(null);
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
    try {
      const blob = await stitchImages(
        photos.map((photo) => getImageUrl(photo.path)),
        (info) => setStitchStage(info.stage)
      );
      const file = new File([blob], 'panorama.jpg', { type: 'image/jpeg' });
      const uploadResult = await UploadService.uploadImage(file, currentProject._id);
      if (uploadResult.success) {
        setResultPreview(getImageUrl(uploadResult.data.path));
        success('Panorama saved', 'It is now available as an asset — add it to a scene in Scene Builder.');
      }
    } catch (err) {
      error('Could not stitch these photos', err.message);
    } finally {
      setStitching(false);
      setStitchStage(null);
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
                <Progress percent={stitchStage === 'done' ? 100 : 60} showInfo={false} status="active" />
                <span>{STAGE_LABELS[stitchStage] || 'Working…'}</span>
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
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
