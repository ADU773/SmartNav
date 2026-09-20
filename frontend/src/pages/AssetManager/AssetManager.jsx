/**
 * SmartNav360 — Asset Manager Page
 * Upload, preview, and manage panoramic images and other assets.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Upload, Button, Progress, Segmented, Tooltip } from 'antd';
import {
  InboxOutlined,
  UploadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DeleteOutlined,
  EyeOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNotification } from '../../contexts/NotificationContext';
import { MESSAGES } from '../../constants/messages';
import UploadService from '../../services/upload.service';
import { getImageUrl } from '../../utils/getImageUrl';
import { formatRelativeDate } from '../../utils/formatDate';
import { showConfirmDialog } from '../../components/common/ConfirmDialog';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import SearchBar from '../../components/common/SearchBar';
import EmptyState from '../../components/common/EmptyState';
import { useProject } from "../../contexts/ProjectContext";
import './AssetManager.css';

const { Dragger } = Upload;

export default function AssetManager() {
  useDocumentTitle('Assets');

  const { success, error } = useNotification();
  const { currentProject } = useProject();
  const [assets, setAssets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewAsset, setPreviewAsset] = useState(null);

  const loadAssets = async () => {

    if (!currentProject?._id) {
      setAssets([]);
      return;
    }

    try {

      const result = await UploadService.getUploads(currentProject._id);

      if (result.success) {

        const formattedAssets = result.data.map((asset, index) => ({

          id: asset._id || index,
          filename: asset.filename,
          displayName: asset.originalName || asset.filename,
          path: asset.path,
          uploadedAt: asset.uploadedAt

        }));

        setAssets(formattedAssets);

      }

    } catch (err) {

      console.error("Failed to load assets:", err);

    }

  };

  useEffect(() => {

    loadAssets();

  }, [currentProject?._id]);

  const filteredAssets = assets.filter((a) =>
    a.filename?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isPreviewableImage = (asset) => !asset.displayName?.toLowerCase().endsWith('.exr');

  const handleUpload = useCallback(
    async (options) => {
      const { file, onSuccess, onError } = options;
      if (!currentProject?._id) {
        const uploadError = new Error('Choose a project before uploading an asset.');
        error('Upload unavailable', uploadError.message);
        onError?.(uploadError);
        return;
      }
      setUploading(true);
      setUploadProgress(0);

      try {
        const result = await UploadService.uploadImage(

    file,

    currentProject._id,

    (percent)=>{

        setUploadProgress(percent);

    }

)

        if (result.success) {

          await loadAssets();

          success(MESSAGES.UPLOAD_SUCCESS);

          onSuccess?.(result);

        }
      } catch (err) {
        error(MESSAGES.UPLOAD_ERROR, err.message);
        onError?.(err);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [success, error, currentProject?._id]
  );

  const handleDelete = (asset) => {
    showConfirmDialog({
      title: 'Delete Asset',
      content: `Are you sure you want to delete "${asset.filename}"? This action cannot be undone.`,
      onConfirm: () => {
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
        success('Asset deleted');
      },
    });
  };

  return (
    <div className="asset-manager">
      <WorkspaceHeader
        title="Asset Manager"
        description="Upload and manage panoramic images and media assets."
        actions={
          <Button type="primary" icon={<UploadOutlined />} onClick={() => document.querySelector('.asset-manager__dragger input[type="file"]')?.click()} disabled={!currentProject}>
            Upload Asset
          </Button>
        }
      >
        <div className="asset-manager__toolbar">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search assets..."
          />
          <Segmented
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'grid', icon: <AppstoreOutlined /> },
              { value: 'list', icon: <UnorderedListOutlined /> },
            ]}
          />
        </div>
      </WorkspaceHeader>

      {/* Upload Area */}
      <Dragger
        customRequest={handleUpload}
        showUploadList={false}
        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
        className="asset-manager__dragger"
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          Click or drag 360° panoramic images to upload
        </p>
        <p className="ant-upload-hint">
          Supports JPG, PNG, WebP, and GIF images up to 100 MB. Convert SVG or EXR files before uploading.
        </p>
      </Dragger>

      {uploading && (
        <div className="asset-manager__progress">
          <Progress percent={uploadProgress} status="active" />
        </div>
      )}

      {/* Assets Grid */}
      {filteredAssets.length > 0 ? (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          {filteredAssets.map((asset) => (
            <Col xs={24} sm={12} md={8} lg={6} key={asset.id}>
              <Card
                className="asset-manager__card"
                cover={
                  <div className="asset-manager__preview">
                    {isPreviewableImage(asset) ? (
                      <img
                        src={getImageUrl(asset.path)}
                        alt={asset.displayName}
                        className="asset-manager__image"
                      />
                    ) : (
                      <div className="asset-manager__exr-preview"><PictureOutlined /><span>EXR 360° panorama</span></div>
                    )}
                    <div className="asset-manager__overlay">
                      <Tooltip title="Preview">
                        <Button
                          type="text"
                          icon={<EyeOutlined />}
                          className="asset-manager__overlay-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewAsset(asset);
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="Delete">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          className="asset-manager__overlay-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(asset);
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                }
              >
                <Card.Meta
                  title={asset.displayName}
                  description={formatRelativeDate(asset.uploadedAt)}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        !uploading && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon={PictureOutlined}
              title="No assets yet"
              description="Upload your first panoramic image to get started."
            />
          </div>
        )
      )}
    </div>
  );
}
