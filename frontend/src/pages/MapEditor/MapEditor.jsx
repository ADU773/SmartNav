/**
 * SmartNav360 — Map Editor Page
 * Choose a floor-plan image, then place each scene's location on it to
 * power the live mini-map shown throughout the virtual experience.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, List, Select, Space, Spin, Tag } from 'antd';
import { EnvironmentOutlined, SaveOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import ProjectService from '../../services/project.service';
import SceneService from '../../services/scene.service';
import UploadService from '../../services/upload.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import MiniMap from '../../components/map/MiniMap';
import './MapEditor.css';

export default function MapEditor() {
  useDocumentTitle('Map Editor');

  const { currentProject } = useProject();
  const { success, error } = useNotification();

  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState();
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!currentProject?._id) return;
    try {
      const [projectResult, sceneResult, assetResult] = await Promise.all([
        ProjectService.getProject(currentProject._id),
        SceneService.getScenes(currentProject._id),
        UploadService.getUploads(currentProject._id),
      ]);
      setProject(projectResult.data);
      setScenes(sceneResult.data || []);
      setAssets((assetResult.data || []).filter((asset) => !asset.originalName?.toLowerCase().endsWith('.exr')));
    } catch (err) {
      error('Could not load the map editor', err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?._id]);

  const placeScene = async ({ x, y }) => {
    if (!selectedId) {
      error('Select a scene first', 'Choose a scene from the list, then click its position on the map.');
      return;
    }
    const mapPosition = { x, y };
    setScenes((items) => items.map((scene) => (scene._id === selectedId ? { ...scene, mapPosition } : scene)));
    try {
      await SceneService.updateScene(selectedId, { mapPosition });
      success('Scene location saved');
    } catch (err) {
      error('Could not save scene location', err.message);
    }
  };

  const chooseFloorPlan = async (floorPlan) => {
    setProject((value) => ({ ...value, floorPlan }));
    try {
      await ProjectService.updateProject(project._id, { floorPlan });
      success('Floor plan saved');
    } catch (err) {
      error('Could not save floor plan', err.message);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        ProjectService.updateProject(project._id, { floorPlan: project.floorPlan || '' }),
        ...scenes.filter((scene) => scene.mapPosition).map((scene) => SceneService.updateScene(scene._id, { mapPosition: scene.mapPosition })),
      ]);
      success('Map saved', 'Floor plan and scene locations are ready for the mini-map.');
    } catch (err) {
      error('Could not save map', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!currentProject) {
    return <Empty description="Choose a project to build its map." />;
  }

  const placedCount = scenes.filter((scene) => scene.mapPosition).length;

  return (
    <div className="map-editor">
      <WorkspaceHeader
        title="2D Map Editor"
        description="Select a floor plan, choose a scene, then click the map to place its location."
        actions={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            Save map
          </Button>
        }
      />

      <div className="map-editor__grid">
        <Card title="Map layout" className="map-editor__canvas-card">
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            <label className="map-editor__label">Floor plan image</label>
            <Select
              value={project?.floorPlan || undefined}
              placeholder="Choose an uploaded floor-plan image"
              onChange={chooseFloorPlan}
              options={assets.map((asset) => ({ value: asset.path, label: asset.originalName || asset.filename }))}
            />
            {!project?.floorPlan && (
              <Alert
                type="info"
                showIcon
                message="Choose a 2D floor-plan image"
                description="Upload a JPG, PNG, or WebP layout in Assets, select it here, then place each scene. These saved items appear in the live mini-map."
              />
            )}
          </Space>
          <Spin spinning={!project}>
            <MiniMap
              floorPlan={project?.floorPlan}
              scenes={scenes}
              activeSceneId={selectedId}
              onSelect={setSelectedId}
              interactive
              onPlace={placeScene}
            />
          </Spin>
        </Card>

        <Card
          title="Scene locations"
          extra={<Tag color={placedCount === scenes.length && scenes.length > 0 ? 'green' : 'default'}>{placedCount}/{scenes.length} placed</Tag>}
        >
          <List
            dataSource={scenes}
            locale={{ emptyText: 'Create scenes before mapping them.' }}
            renderItem={(scene) => (
              <List.Item
                className={`map-editor__scene ${scene._id === selectedId ? 'map-editor__scene--active' : ''}`}
                onClick={() => setSelectedId(scene._id)}
              >
                <Space>
                  <EnvironmentOutlined />
                  <span>{scene.name}</span>
                </Space>
                {scene.mapPosition ? <Tag color="green">Placed</Tag> : <Tag>Not placed</Tag>}
              </List.Item>
            )}
          />
        </Card>
      </div>
    </div>
  );
}
