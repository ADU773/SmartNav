/**
 * SmartNav360 — Floor Plan Page
 * Upload a 2D floor plan and generate a photorealistic top-down 3D render
 * with AI, then set it as this project's floor plan (used by Map Editor).
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Image, Tag, Upload } from 'antd';
import { DisconnectOutlined, InboxOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import ProjectService from '../../services/project.service';
import UploadService from '../../services/upload.service';
import {
  PuterAuthError,
  generateFloorPlanRender,
  getPuterUser,
  isPuterSignedIn,
  puterErrorMessage,
  signInToPuter,
  signOutOfPuter,
} from '../../services/puter.service';
import { getImageUrl } from '../../utils/getImageUrl';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './FloorPlan.css';

const { Dragger } = Upload;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_SIZE = 500 * 1024 * 1024;

export default function FloorPlan() {
  useDocumentTitle('Floor Plan');

  const { currentProject, selectProject } = useProject();
  const { success, error } = useNotification();

  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePreview, setSourcePreview] = useState(null);
  const [renderedImage, setRenderedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [puterUser, setPuterUser] = useState(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isPuterSignedIn()) return undefined;
    getPuterUser().then((user) => {
      if (!cancelled) setPuterUser(user);
    });
    return () => { cancelled = true; };
  }, []);

  // Must not await anything before signInToPuter(): Puter opens its sign-in
  // popup synchronously, and any earlier await spends the click's user
  // activation, which makes the browser block the popup.
  const connectPuter = () => {
    setConnecting(true);
    signInToPuter()
      .then(() => getPuterUser())
      .then((user) => {
        setPuterUser(user);
        success('Puter account connected', 'You can now generate 3D renders.');
      })
      .catch((err) => error('Could not connect your Puter account', puterErrorMessage(err)))
      .finally(() => setConnecting(false));
  };

  const disconnectPuter = () => {
    try {
      signOutOfPuter();
    } finally {
      setPuterUser(null);
      success('Puter account disconnected');
    }
  };

  const validateFile = (file) => {
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      error('Unsupported file', 'Upload a JPG, PNG, or WebP floor plan.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_SIZE) {
      error('File is too large', 'Choose an image 500 MB or smaller.');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const handleSelectFile = async (file) => {
    setSourceFile(file);
    setSourcePreview(URL.createObjectURL(file));
    setRenderedImage(null);
    setUploading(true);
    try {
      const result = await UploadService.uploadImage(file, currentProject._id);
      if (result.success) {
        success('Floor plan uploaded', 'Generate a 3D render below, or upload a different image.');
      }
    } catch (err) {
      error('Upload failed', puterErrorMessage(err));
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  };

  const handleGenerate = async () => {
    if (!sourceFile) return;
    setRendering(true);
    try {
      const renderDataUrl = await generateFloorPlanRender(sourceFile);
      setRenderedImage(renderDataUrl);

      const renderResponse = await fetch(renderDataUrl);
      const renderBlob = await renderResponse.blob();
      const renderFile = new File([renderBlob], 'floorplan-render.png', { type: renderBlob.type || 'image/png' });

      const uploadResult = await UploadService.uploadImage(renderFile, currentProject._id);
      if (uploadResult.success) {
        await ProjectService.updateProject(currentProject._id, { floorPlan: uploadResult.data.path });
        selectProject({ ...currentProject, floorPlan: uploadResult.data.path });
        success('3D render ready', "Set as this project's floor plan — pick it up in Map Editor.");
      }
    } catch (err) {
      if (err instanceof PuterAuthError) {
        setPuterUser(null);
        error('Connect a Puter account first', err.message);
      } else {
        error('Could not generate the 3D render', puterErrorMessage(err));
      }
    } finally {
      setRendering(false);
    }
  };

  if (!currentProject) {
    return <Empty description="Choose a project to generate a floor plan render." />;
  }

  const connected = !!puterUser || isPuterSignedIn();

  return (
    <div className="floor-plan">
      <WorkspaceHeader
        title="Floor Plan"
        description="Upload a 2D floor plan and generate a photorealistic 3D render with AI, powered by Puter.js."
        actions={
          connected ? (
            <Button icon={<DisconnectOutlined />} onClick={disconnectPuter}>
              Disconnect Puter
            </Button>
          ) : (
            <Button type="primary" icon={<UserOutlined />} loading={connecting} onClick={connectPuter}>
              Connect Puter account
            </Button>
          )
        }
      />

      {connected ? (
        <div className="floor-plan__account">
          <Tag color="green">Puter connected</Tag>
          {puterUser?.username && <span className="floor-plan__account-name">{puterUser.username}</span>}
        </div>
      ) : (
        <Alert
          className="floor-plan__notice"
          type="info"
          showIcon
          title="Connect a free Puter account to render"
          description="Rendering runs on Puter's hosted Gemini model. Click Connect Puter account and finish sign-in in the popup — it is a separate, free account, not your SmartNav360 login."
        />
      )}

      <Card className="floor-plan__upload-card">
        <Dragger
          showUploadList={false}
          beforeUpload={validateFile}
          customRequest={({ file }) => handleSelectFile(file)}
          accept=".jpg,.jpeg,.png,.webp"
          disabled={uploading}
          className="floor-plan__dragger"
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Click or drag a 2D floor plan to upload</p>
          <p className="ant-upload-hint">Supports JPG, PNG, and WebP images up to 500 MB.</p>
        </Dragger>
      </Card>

      {sourcePreview && (
        <div className="floor-plan__compare">
          <Card title="Original" className="floor-plan__panel">
            <Image src={sourcePreview} alt="Original floor plan" className="floor-plan__image" />
          </Card>

          <Card
            title="AI Render"
            className="floor-plan__panel"
            extra={
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={rendering}
                disabled={uploading || !connected}
                onClick={handleGenerate}
              >
                {renderedImage ? 'Regenerate' : 'Generate 3D Render'}
              </Button>
            }
          >
            {renderedImage ? (
              <Image src={renderedImage} alt="AI-rendered floor plan" className="floor-plan__image" />
            ) : (
              <div className="floor-plan__placeholder">
                {rendering && 'Rendering with Puter AI — this can take a moment…'}
                {!rendering && !connected && 'Connect a Puter account to enable rendering.'}
                {!rendering && connected && 'Click "Generate 3D Render" to send this floor plan to Puter\'s hosted Gemini model.'}
              </div>
            )}
          </Card>
        </div>
      )}

      {!sourcePreview && currentProject.floorPlan && (
        <Card title="Current floor plan" className="floor-plan__current">
          <Image src={getImageUrl(currentProject.floorPlan)} alt="Current floor plan" className="floor-plan__image" />
        </Card>
      )}
    </div>
  );
}
