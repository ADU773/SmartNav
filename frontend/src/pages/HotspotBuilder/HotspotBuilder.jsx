/**
 * SmartNav360 — Hotspot Builder Page
 * Manage scene connections and prepare for future visual hotspot editing.
 */
import { useProject } from "../../contexts/ProjectContext";
import { useState, useEffect } from 'react';
import { Button, Card, Row, Col, Spin, Select } from 'antd';
import { PlusOutlined, NodeIndexOutlined, ApiOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNotification } from '../../contexts/NotificationContext';
import { MESSAGES } from '../../constants/messages';
import SceneService from '../../services/scene.service';
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
  const [selectedScene, setSelectedScene] = useState(null);

  const loadScenes = async () => {
    if (!currentProject?._id) {
      setScenes([]);
      setSelectedScene(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await SceneService.getScenes(currentProject._id);
      if (result.success) {
        const data = result.data || [];

        setScenes(data);

        setSelectedScene((current) => data.find((scene) => scene._id === current?._id) || data[0] || null);
      }
    } catch (err) {
      error(MESSAGES.SCENE_LOAD_ERROR, err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScenes();
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
        loadScenes();
      }
    } catch (err) {
      error(MESSAGES.CONNECTION_ERROR, err.message);
      throw err;
    }
  };

  const hasConnections = scenes.some((s) => s.hotspots?.length > 0);

  return (
    <div className="hotspot-builder">
      <WorkspaceHeader
        title="Hotspot Builder"
        description="Connect scenes to create navigation paths for the virtual experience."
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setClickedCoordinates(null); setModalOpen(true); }}
            disabled={scenes.length < 2}
          >
            Connect Scenes
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="Scene Connections">
            <Spin spinning={loading}>
              {hasConnections ? (
                <HotspotTable scenes={scenes} loading={loading} />
              ) : (
                <EmptyState
                  icon={NodeIndexOutlined}
                  title="No connections yet"
                  description="Connect two or more scenes to create navigation paths."
                  actionLabel={scenes.length >= 2 ? 'Connect Scenes' : undefined}
                  actionIcon={<PlusOutlined />}
                  onAction={scenes.length >= 2 ? () => { setClickedCoordinates(null); setModalOpen(true); } : undefined}
                />
              )}
            </Spin>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          {/* Future: Visual Graph */}
          <Card
            title="Hotspot Editor"
            className="hotspot-builder__graph-card"
          >
            <Select
              style={{ width: "100%", marginBottom: 16 }}
              value={selectedScene?._id}
              onChange={(value) => {

                const scene = scenes.find(
                  s => s._id === value
                );

                setSelectedScene(scene);

              }}
              options={scenes.map(scene => ({
                value: scene._id,
                label: scene.name
              }))}
            />
            {selectedScene ? (

              <PanoramaViewer
                scene={selectedScene}
                editMode={true}
                onPanoramaClick={(coords) => {

                  setClickedCoordinates(coords);

                  setModalOpen(true);

                }}
              />

            ) : (

              <EmptyState
                title="Select a Scene"
                description="Choose a scene to begin hotspot editing."
              />

            )}

          </Card>

          {/* Stats */}
          <Card title="Connection Stats" style={{ marginTop: 16 }}>
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Total Scenes</span>
              <span className="hotspot-builder__stat-value">{scenes.length}</span>
            </div>
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Total Connections</span>
              <span className="hotspot-builder__stat-value">
                {scenes.reduce((acc, s) => acc + (s.hotspots?.length || 0), 0)}
              </span>
            </div>
            <div className="hotspot-builder__stat">
              <span className="hotspot-builder__stat-label">Connected Scenes</span>
              <span className="hotspot-builder__stat-value">
                {scenes.filter((s) => s.hotspots?.length > 0).length}
              </span>
            </div>
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
