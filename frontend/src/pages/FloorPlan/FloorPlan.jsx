/**
 * SmartNav360 — Floor Plan Page
 * Upload a 2D floor plan and generate a photorealistic top-down 3D render
 * with AI, then set it as this project's floor plan (used by Map Editor).
 */

import { useState } from 'react';
import { Button, Card, Empty, Image, Upload } from 'antd';
import { InboxOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import ProjectService from '../../services/project.service';
import UploadService from '../../services/upload.service';
import { generateFloorPlanRender } from '../../services/puter.service';
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
      error('Upload failed', err.message);
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
      error('Could not generate the 3D render', err.message);
    } finally {
      setRendering(false);
    }
  };

  if (!currentProject) {
    return <Empty description="Choose a project to generate a floor plan render." />;
  }

  return (
    <div className="floor-plan">
      <WorkspaceHeader
        title="Floor Plan"
        description="Upload a 2D floor plan and generate a photorealistic 3D render with AI, powered by Puter.js."
      />

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
                disabled={uploading}
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
                {rendering
                  ? 'Rendering with Puter AI — sign in if prompted, this can take a moment…'
                  : 'Click "Generate 3D Render" to send this floor plan to Puter\'s hosted Gemini model.'}
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
