/**
 * SmartNav360 — Hotspot Builder Page
 * Street View-style workflow: pick a scene, click on the panorama to drop a
 * connection point, then choose where it leads. Existing pins can be clicked
 * again to remove them.
 */
import { useProject } from "../../contexts/ProjectContext";
import { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Card, Row, Col, Spin, Modal } from 'antd';
import { PlusOutlined, NodeIndexOutlined, AimOutlined, LinkOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNotification } from '../../contexts/NotificationContext';
import { MESSAGES } from '../../constants/messages';
import SceneService from '../../services/scene.service';
import { getImageUrl } from '../../utils/getImageUrl';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import HotspotTable from '../../components/hotspots/HotspotTable';
import HotspotModal from '../../components/hotspots/HotspotModal';
import EmptyState from '../../components/common/EmptyState';
import PanoramaViewer from '../../components/experience/PanoramaViewer';
import './HotspotBuilder.css';

export default function HotspotBuilder() {
  useDocumentTitle('Hotspots');
  const { currentProject } = useProject();
  const { success, error } = useNotification();
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [clickedCoordinates, setClickedCoordinates] = useState(null);
  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const viewerCardRef = useRef(null);

  const selectedScene = useMemo(
    () => scenes.find((s) => s._id === selectedSceneId) || null,
    [scenes, selectedSceneId]
  );

  const loadScenes = async (preferredSceneId) => {
    if (!currentProject?._id) {
      setScenes([]);
      setSelectedSceneId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await SceneService.getScenes(currentProject._id);
      if (result.success) {
        const data = result.data || [];
        setScenes(data);
        setSelectedSceneId((current) => {
          const target = preferredSceneId || current;
          return data.find((scene) => scene._id === target)?._id || data[0]?._id || null;
        });
      }
    } catch (err) {
      error(MESSAGES.SCENE_LOAD_ERROR, err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?._id]);

  const handleConnect = async (values) => {
    try {
      const { targetSceneId, label, distance } = values;

      const result = await SceneService.connectScenes(
        selectedScene._id,
        {
          targetSceneId,
          label,
          yaw: Number.isFinite(clickedCoordinates?.yaw) ? clickedCoordinates.yaw : 0,
          pitch: Number.isFinite(clickedCoordinates?.pitch) ? clickedCoordinates.pitch : 0,
          distance: Number.isFinite(distance) ? distance : 0,
        }
      );
      if (result.success) {
        success(MESSAGES.CONNECTION_ADDED);
        loadScenes(selectedScene._id);
      }
    } catch (err) {
      error(MESSAGES.CONNECTION_ERROR, err.message);
      throw err;
    }
  };

  const removeHotspot = async (sourceSceneId, hotspotIndex) => {
    const source = scenes.find((s) => s._id === sourceSceneId);
    if (!source) return;
    try {
      const updatedHotspots = (source.hotspots || []).filter((_, idx) => idx !== hotspotIndex);
      const result = await SceneService.updateScene(sourceSceneId, { hotspots: updatedHotspots });
      if (result.success) {
        success(MESSAGES.CONNECTION_REMOVED);
        loadScenes(sourceSceneId);
      }
    } catch (err) {
      error(MESSAGES.CONNECTION_DELETE_ERROR, err.message);
    }
  };

  const confirmRemoveHotspot = (sourceSceneId, hotspot, hotspotIndex) => {
    const targetName = scenes.find((s) => s._id === hotspot.targetScene)?.name || 'Unknown scene';
    Modal.confirm({
      title: 'Remove this connection?',
      content: `This will remove the link to "${targetName}".`,
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: () => removeHotspot(sourceSceneId, hotspotIndex),
    });
  };

  const openConnectModal = (coords = null) => {
    setClickedCoordinates(coords);
    setModalOpen(true);
  };

  const hasConnections = scenes.some((s) => s.hotspots?.length > 0);
  const totalConnections = scenes.reduce((acc, s) => acc + (s.hotspots?.length || 0), 0);
  const connectedScenes = scenes.filter((s) => s.hotspots?.length > 0).length;

  return (
    <div className="hotspot-builder">
      <WorkspaceHeader
        title="Hotspot Builder"
        description="Connect scenes to create navigation paths — click a spot on the panorama, then pick where it leads."
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openConnectModal(null)}
            disabled={!selectedScene || scenes.length < 2}
          >
            Connect Scenes
          </Button>
        }
      />

      {scenes.length > 0 && (
        <div className="hotspot-builder__scene-strip" role="tablist" aria-label="Scenes">
          {scenes.map((scene) => {
            const count = scene.hotspots?.length || 0;
            const isActive = scene._id === selectedScene?._id;
            return (
              <button
                key={scene._id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`hotspot-builder__scene-chip ${isActive ? 'is-active' : ''}`}
                onClick={() => setSelectedSceneId(scene._id)}
              >
                <span
                  className="hotspot-builder__scene-chip-thumb"
                  style={{ backgroundImage: scene.image ? `url(${getImageUrl(scene.image)})` : 'none' }}
                />
                <span className="hotspot-builder__scene-chip-info">
                  <span className="hotspot-builder__scene-chip-name">{scene.name}</span>
                  <span className="hotspot-builder__scene-chip-count">
                    <LinkOutlined /> {count}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={17}>
          <Card
            ref={viewerCardRef}
            title={selectedScene ? `Editing — ${selectedScene.name}` : 'Panorama Editor'}
            className="hotspot-builder__viewer-card"
          >
            {selectedScene ? (
              <>
                <div className="hotspot-builder__hint">
                  <AimOutlined /> Click anywhere on the panorama to drop a connection point. Click an existing pin to remove it.
                </div>
                <PanoramaViewer
                  scene={selectedScene}
                  editMode={true}
                  onPanoramaClick={(coords) => openConnectModal(coords)}
                  onHotspotSelect={(hotspot, index) => confirmRemoveHotspot(selectedScene._id, hotspot, index)}
                />
              </>
            ) : (
              <EmptyState
                icon={NodeIndexOutlined}
                title={scenes.length === 0 ? 'No scenes yet' : 'Select a scene'}
                description={
                  scenes.length === 0
                    ? 'Upload scenes in the Scene Builder before creating hotspot connections.'
                    : 'Choose a scene above to begin placing connections.'
                }
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={7}>
          <Card title="Connection Stats" className="hotspot-builder__stats-card">
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Total Scenes</span>
              <span className="hotspot-builder__stat-value">{scenes.length}</span>
            </div>
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Total Connections</span>
              <span className="hotspot-builder__stat-value">{totalConnections}</span>
            </div>
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Connected Scenes</span>
              <span className="hotspot-builder__stat-value">{connectedScenes}</span>
            </div>
          </Card>

          <Card title="Scene Connections" className="hotspot-builder__table-card" style={{ marginTop: 16 }}>
            <Spin spinning={loading}>
              {hasConnections ? (
                <HotspotTable
                  scenes={scenes}
                  loading={loading}
                  onDelete={(record) => confirmRemoveHotspot(record.sourceSceneId, { targetScene: record.targetSceneId }, record.hotspotIndex)}
                  onLocate={(record) => {
                    setSelectedSceneId(record.sourceSceneId);
                    viewerCardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                  }}
                />
              ) : (
                <EmptyState
                  icon={NodeIndexOutlined}
                  title="No connections yet"
                  description="Connect two or more scenes to create navigation paths."
                  actionLabel={scenes.length >= 2 && selectedScene ? 'Connect Scenes' : undefined}
                  actionIcon={<PlusOutlined />}
                  onAction={scenes.length >= 2 && selectedScene ? () => openConnectModal(null) : undefined}
                />
              )}
            </Spin>
          </Card>
        </Col>
      </Row>

      <HotspotModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setClickedCoordinates(null); }}
        onSubmit={handleConnect}
        scenes={scenes}
        coordinates={clickedCoordinates}
        sourceScene={selectedScene}
      />
    </div>
  );
}
