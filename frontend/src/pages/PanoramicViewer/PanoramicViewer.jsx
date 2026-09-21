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
import { getImageUrl } from '../../utils/getImageUrl';
import { ROUTES } from '../../constants/routes';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import EmptyState from '../../components/common/EmptyState';
import './PanoramicViewer.css';

const STAGE_LABELS = {
  'loading-library': 'Loading the stitching engine…',
  'loading-photo': 'Loading photos…',
  stitching: 'Aligning photos…',
  encoding: 'Encoding the panorama…',
  done: 'Done.',
};

// Rough progress per stage, so the bar advances instead of sitting at 60%.
const STAGE_PERCENT = {
  'loading-library': 15,
  'loading-photo': 35,
  stitching: 70,
  encoding: 92,
  done: 100,
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
  const workerRef = useRef(null);

  // Live updates over SSE. One held connection replaces a request every 2.5s
  // per open viewer, and photos appear as soon as the phone uploads them.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    // One immediate read so the card is populated before the first event.
    PanoramaService.getSession(token)
      .then((result) => {
        if (cancelled || !result.success) return;
        setPhotos(result.data.photos || []);
        setSessionStatus(result.data.status);
      })
      .catch(() => {});

    const unsubscribe = PanoramaService.subscribe(
      token,
      (data) => {
        if (cancelled) return;
        setPhotos(data.photos || []);
        setSessionStatus(data.status);
      },
      (event) => {
        if (event?.expired && !cancelled) setSessionStatus('expired');
      }
    );

    return () => { cancelled = true; unsubscribe(); };
  }, [token]);

  // Terminate a running stitch if the page unmounts mid-job.
  useEffect(() => () => workerRef.current?.terminate(), []);

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

  const stitch = () => {
    setStitching(true);
    setStitchStage('loading-library');

    // OpenCV.js is a multi-megabyte WASM module and the composite step is a
    // per-pixel loop over a growing canvas. Both run in a worker so the page
    // stays responsive and the progress bar keeps animating.
    const worker = new Worker(new URL('../../workers/stitch.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    const finish = () => {
      worker.terminate();
      workerRef.current = null;
      setStitching(false);
      setStitchStage(null);
    };

    worker.onmessage = async (event) => {
      const message = event.data;
      if (message.type === 'progress') {
        setStitchStage(message.stage);
        return;
      }
      if (message.type === 'error') {
        error('Could not stitch these photos', message.message);
        finish();
        return;
      }
      try {
        const file = new File([message.blob], 'panorama.jpg', { type: 'image/jpeg' });
        const uploadResult = await UploadService.uploadImage(file, currentProject._id);
        if (uploadResult.success) {
          setResultPreview(getImageUrl(uploadResult.data.path));
          success('Panorama saved', 'It is now available as an asset — add it to a scene in Scene Builder.');
        }
      } catch (err) {
        error('Could not save the panorama', err.message);
      } finally {
        finish();
      }
    };

    worker.onerror = (event) => {
      error('Could not stitch these photos', event.message || 'The stitching worker failed to start.');
      finish();
    };

    worker.postMessage({ imageUrls: photos.map((photo) => getImageUrl(photo.path)) });
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
              {sessionStatus === 'done' && 'The phone marked this session as done.'}
              {sessionStatus === 'expired' && 'This session expired. Start a new one.'}
              {sessionStatus !== 'done' && sessionStatus !== 'expired' && (
                photos.length > 0
                  ? `${photos.length} photo${photos.length === 1 ? '' : 's'} received — keep going, or stitch now.`
                  : 'Waiting for photos — this page updates live.'
              )}
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
                <Progress percent={STAGE_PERCENT[stitchStage] ?? 10} showInfo={false} status="active" />
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
