/**
 * SmartNav360 — Asset Manager Page
 * Upload, preview, and manage panoramic images and other assets.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Upload, Button, Progress, Segmented, Tooltip, Table, Modal, Image } from 'antd';
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
const ALLOWED_ASSET_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.exr'];
const MAX_ASSET_SIZE = 500 * 1024 * 1024;

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
  const draggerInputRef = useRef(null);

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
          uploadedAt: asset.uploadedAt,
        }));
        setAssets(formattedAssets);
      }
    } catch (err) {
      error(MESSAGES.ASSET_LOAD_ERROR, err.message);
    }
  };

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?._id]);

  const filteredAssets = assets.filter((a) =>
    a.filename?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isPreviewableImage = (asset) => !asset.displayName?.toLowerCase().endsWith('.exr');

  const validateAsset = (file) => {
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!ALLOWED_ASSET_EXTENSIONS.includes(extension)) {
      error('Unsupported asset', 'Upload a JPG, PNG, WebP, GIF, SVG, or EXR panorama.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_ASSET_SIZE) {
      error('Asset is too large', 'Choose an image that is 500 MB or smaller.');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

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
        const result = await UploadService.uploadImage(file, currentProject._id, (percent) => {
          setUploadProgress(percent);
        });

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
      content: `Are you sure you want to delete "${asset.displayName}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          const result = await UploadService.deleteAsset(asset.id);
          if (result.success) {
            setAssets((prev) => prev.filter((a) => a.id !== asset.id));
            success(MESSAGES.ASSET_DELETED);
          }
        } catch (err) {
          error(MESSAGES.ASSET_DELETE_ERROR, err.message);
        }
      },
    });
  };

  const tableColumns = [
    {
      title: '',
      dataIndex: 'path',
      key: 'thumb',
      width: 64,
      render: (_, asset) => (
        <div className="asset-manager__row-thumb">
          {isPreviewableImage(asset) ? (
            <img src={getImageUrl(asset.path)} alt={asset.displayName} />
          ) : (
            <PictureOutlined />
          )}
        </div>
      ),
    },
    { title: 'Name', dataIndex: 'displayName', key: 'name', ellipsis: true },
    {
      title: 'Uploaded',
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      width: 160,
      render: (value) => formatRelativeDate(value),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_, asset) => (
        <span className="asset-manager__row-actions">
          <Tooltip title="Preview">
            <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => setPreviewAsset(asset)} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" onClick={() => handleDelete(asset)} />
          </Tooltip>
        </span>
      ),
    },
  ];

  return (
    <div className="asset-manager">
      <WorkspaceHeader
        title="Asset Manager"
        description="Upload and manage panoramic images and media assets."
        actions={
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => draggerInputRef.current?.click()}
            disabled={!currentProject}
          >
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
        beforeUpload={validateAsset}
        accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.exr"
        className="asset-manager__dragger"
        openFileDialogOnClick={false}
      >
        <input
          ref={draggerInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.exr"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (validateAsset(file) === true) handleUpload({ file });
          }}
        />
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          Click or drag 360° panoramic images to upload
        </p>
        <p className="ant-upload-hint">
          Supports JPG, PNG, WebP, GIF, SVG, and EXR panoramas up to 500 MB.
        </p>
      </Dragger>

      {uploading && (
        <div className="asset-manager__progress">
          <Progress percent={uploadProgress} status="active" />
        </div>
      )}

      {/* Assets */}
      {filteredAssets.length > 0 ? (
        viewMode === 'grid' ? (
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
          <Table
            className="asset-manager__table"
            style={{ marginTop: 24 }}
            rowKey="id"
            dataSource={filteredAssets}
            columns={tableColumns}
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
        )
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

      <Modal
        open={!!previewAsset}
        onCancel={() => setPreviewAsset(null)}
        footer={null}
        title={previewAsset?.displayName}
        centered
        width={720}
      >
        {previewAsset && (
          isPreviewableImage(previewAsset) ? (
            <Image
              src={getImageUrl(previewAsset.path)}
              alt={previewAsset.displayName}
              style={{ width: '100%', borderRadius: 8 }}
              preview={false}
            />
          ) : (
            <div className="asset-manager__exr-preview" style={{ height: 240, borderRadius: 8 }}>
              <PictureOutlined />
              <span>EXR panoramas can't be previewed in the browser.</span>
            </div>
          )
        )}
      </Modal>
    </div>
  );
}
