/**
 * SmartNav360 — Panorama Capture Page
 * Standalone, phone-optimized page opened by scanning a Panoramic Viewer QR
 * code. No sidebar, no login — the session token in the URL is the
 * credential, valid for about an hour.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Result, Spin } from 'antd';
import { CameraOutlined, CheckCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import PanoramaService from '../../services/panorama.service';
import { getImageUrl } from '../../utils/getImageUrl';
import Logo from '../../components/common/Logo';
import './PanoramaCapture.css';

export default function PanoramaCapture() {
  useDocumentTitle('Capture Panorama');
  const { token } = useParams();
  const fileInputRef = useRef(null);

  const [status, setStatus] = useState('loading'); // loading | ready | expired | done
  const [photos, setPhotos] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    PanoramaService.getSession(token)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPhotos(result.data.photos || []);
          setStatus(result.data.status === 'done' ? 'done' : 'ready');
        } else {
          setStatus('expired');
        }
      })
      .catch(() => !cancelled && setStatus('expired'));
    return () => { cancelled = true; };
  }, [token]);

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setPendingCount(files.length);
    for (const file of files) {
      try {
        const result = await PanoramaService.uploadPhoto(token, file);
        if (result.success) setPhotos(result.data.photos || []);
      } catch {
        // Keep capturing — one failed shot shouldn't block the rest.
      } finally {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    }
    event.target.value = '';
  };

  const finish = async () => {
    setCompleting(true);
    try {
      await PanoramaService.completeSession(token);
      setStatus('done');
    } catch {
      setCompleting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="panorama-capture panorama-capture--centered">
        <Spin indicator={<LoadingOutlined spin />} />
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="panorama-capture panorama-capture--centered">
        <Result status="warning" title="This session has expired" subTitle="Ask for a fresh QR code from the Panoramic Viewer page." />
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="panorama-capture panorama-capture--centered">
        <Result
          icon={<CheckCircleFilled className="panorama-capture__done-icon" />}
          title="You're all set"
          subTitle="Go back to your computer — the panorama will be stitched there."
        />
      </div>
    );
  }

  return (
    <div className="panorama-capture">
      <header className="panorama-capture__header">
        <Logo size={32} subtitle="Panorama capture" />
      </header>

      <main className="panorama-capture__body">
        <p className="panorama-capture__instructions">
          Take several overlapping photos, panning slowly around the space. More overlap between shots gives a better panorama.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleFiles}
          className="panorama-capture__input"
        />
        <Button
          type="primary"
          size="large"
          block
          icon={<CameraOutlined />}
          loading={pendingCount > 0}
          onClick={() => fileInputRef.current?.click()}
        >
          {pendingCount > 0 ? `Uploading ${pendingCount}…` : 'Take photos'}
        </Button>

        {photos.length > 0 && (
          <div className="panorama-capture__grid">
            {photos.map((photo) => (
              <img key={photo._id} src={getImageUrl(photo.path)} alt="Captured" className="panorama-capture__thumb" />
            ))}
          </div>
        )}

        <Button block size="large" disabled={photos.length < 2} loading={completing} onClick={finish} className="panorama-capture__done">
          I'm done ({photos.length} photo{photos.length === 1 ? '' : 's'})
        </Button>
      </main>
    </div>
  );
}
