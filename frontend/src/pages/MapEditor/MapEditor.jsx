/**
 * SmartNav360 — Map Editor Page
 * Choose a floor-plan image, place each scene's location on it, and link
 * scenes by drawing on the map: the server turns each link into hotspots in
 * both scenes, pointing the right way and with a real distance.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Empty, InputNumber, List, Segmented, Select, Space, Spin, Tag } from 'antd';
import { AimOutlined, EnvironmentOutlined, NodeIndexOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import ProjectService from '../../services/project.service';
import SceneService from '../../services/scene.service';
import UploadService from '../../services/upload.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import MiniMap from '../../components/map/MiniMap';
import PanoramaViewer from '../../components/experience/PanoramaViewer';
import './MapEditor.css';
import { assetLabel, assetPreviewUrl } from '../../utils/imagePreview';

const ACCESS_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'door', label: 'Door' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'elevator', label: 'Lift' },
  { value: 'escalator', label: 'Escalator' },
  { value: 'stairs', label: 'Stairs' },
];

export default function MapEditor() {
  useDocumentTitle('Map Editor');

  const { currentProject } = useProject();
  const { success, error } = useNotification();

  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState();
  const [saving, setSaving] = useState(false);
  // "place": click the map to position the selected scene.
  // "link": click two pins to connect them.
  const [mode, setMode] = useState('place');
  const [link, setLink] = useState({ from: null, to: null, access: 'flat', twoWay: true });
  const [linking, setLinking] = useState(false);
  // Camera direction of the direction-setting viewer, read when the admin saves it.
  const viewRef = useRef({ yaw: 0 });
  const [settingDirection, setSettingDirection] = useState(false);

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

  const sceneById = (id) => scenes.find((scene) => scene._id === id);
  const selected = sceneById(selectedId);
  const linkFrom = sceneById(link.from);
  const linkTo = sceneById(link.to);

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

  const pickPin = (sceneId) => {
    setSelectedId(sceneId);
    if (mode !== 'link') return;
    setLink((current) => {
      if (!current.from || current.to || current.from === sceneId) return { ...current, from: sceneId, to: null };
      return { ...current, to: sceneId };
    });
  };

  const changeMode = (value) => {
    setMode(value);
    setLink((current) => ({ ...current, from: null, to: null }));
  };

  const createLink = async () => {
    setLinking(true);
    try {
      const result = await SceneService.linkScenes(link.from, { targetSceneId: link.to, access: link.access, twoWay: link.twoWay });
      const { source, target, distance } = result.data;
      setScenes((items) => items.map((scene) => (scene._id === source._id ? source : scene._id === target._id ? target : scene)));
      success(
        `Linked ${source.name} ${link.twoWay ? '↔' : '→'} ${target.name}${distance ? ` · ${distance} m` : ''}`,
        'Hotspots placed from the map. Fine-tune their exact position in Hotspots if needed.',
      );
      setLink((current) => ({ ...current, from: null, to: null }));
    } catch (err) {
      error('Could not link the scenes', err.message);
    } finally {
      setLinking(false);
    }
  };

  const saveDirection = async (mapYawOffset) => {
    if (!selected) return;
    setSettingDirection(true);
    try {
      const result = await SceneService.updateScene(selected._id, { mapYawOffset });
      setScenes((items) => items.map((scene) => (scene._id === selected._id ? { ...scene, mapYawOffset: result.data?.mapYawOffset ?? mapYawOffset } : scene)));
      success(mapYawOffset === null ? 'Map direction cleared' : `Map direction set for ${selected.name}`);
    } catch (err) {
      error('Could not save the map direction', err.message);
    } finally {
      setSettingDirection(false);
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

  const saveScale = async (floorPlanWidthMeters) => {
    if (!project || floorPlanWidthMeters === project.floorPlanWidthMeters) return;
    setProject((value) => ({ ...value, floorPlanWidthMeters }));
    try {
      await ProjectService.updateProject(project._id, { floorPlanWidthMeters: floorPlanWidthMeters ?? null });
      success('Floor plan scale saved', 'Links drawn from now on get distances in metres.');
    } catch (err) {
      error('Could not save the floor plan scale', err.message);
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
  const directionCount = scenes.filter((scene) => Number.isFinite(scene.mapYawOffset)).length;
  const linkHint = !link.from
    ? 'Click the scene the connection starts from.'
    : !link.to ? `Now click the scene to connect ${linkFrom?.name} to.` : null;

  return (
    <div className="map-editor">
      <WorkspaceHeader
        title="2D Map Editor"
        description="Place each scene on the floor plan, then draw links between them: hotspots are created in both scenes automatically."
        actions={
          <Space>
            <Segmented
              value={mode}
              onChange={changeMode}
              options={[
                { value: 'place', label: 'Place scenes', icon: <EnvironmentOutlined /> },
                { value: 'link', label: 'Link scenes', icon: <NodeIndexOutlined /> },
              ]}
            />
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              Save map
            </Button>
          </Space>
        }
      />

      <div className="map-editor__grid">
        <Card title="Map layout" className="map-editor__canvas-card">
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            <div className="map-editor__plan-row">
              <div className="map-editor__plan-field">
                <label className="map-editor__label">Floor plan image</label>
                <Select
                  value={project?.floorPlan || undefined}
                  placeholder="Choose an uploaded floor-plan image"
                  onChange={chooseFloorPlan}
                  options={assets.map((asset) => ({ value: asset.path, label: assetLabel(asset), asset }))}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  optionRender={(option) => (
                    <span className="map-editor__option">
                      <img src={assetPreviewUrl(option.data.asset)} alt="" loading="lazy" />
                      <span>{option.data.label}</span>
                    </span>
                  )}
                />
              </div>
              <div>
                <label className="map-editor__label">Real width</label>
                <InputNumber
                  key={project?._id}
                  min={1}
                  max={100000}
                  addonAfter="m"
                  placeholder="e.g. 40"
                  defaultValue={project?.floorPlanWidthMeters}
                  onBlur={(event) => saveScale(event.target.value === '' ? null : Number(event.target.value))}
                  style={{ width: 130 }}
                  aria-label="Real width of the floor plan in metres"
                />
              </div>
            </div>
            {!project?.floorPlan && (
              <Alert
                type="info"
                showIcon
                message="Choose a 2D floor-plan image"
                description="Upload a JPG, PNG, or WebP layout in Assets, select it here, then place each scene. These saved items appear in the live mini-map."
              />
            )}
            {mode === 'link' && linkHint && <Alert type="info" showIcon message={linkHint} />}
          </Space>
          <Spin spinning={!project}>
            <MiniMap
              floorPlan={project?.floorPlan}
              scenes={scenes}
              activeSceneId={mode === 'link' ? link.from : selectedId}
              routePath={mode === 'link' && link.from && link.to ? [link.from, link.to] : []}
              onSelect={pickPin}
              interactive={mode === 'place'}
              onPlace={placeScene}
            />
          </Spin>

          {mode === 'link' && linkFrom && linkTo && (
            <Card size="small" className="map-editor__link-card" title={<span><SwapOutlined /> {linkFrom.name} {link.twoWay ? '↔' : '→'} {linkTo.name}</span>}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <span className="map-editor__label">How is it walked?</span>
                <Segmented
                  block
                  value={link.access}
                  onChange={(access) => setLink((current) => ({ ...current, access }))}
                  options={ACCESS_OPTIONS}
                />
                <Checkbox checked={link.twoWay} onChange={(event) => setLink((current) => ({ ...current, twoWay: event.target.checked }))}>
                  Add the way back too
                </Checkbox>
                <Space>
                  <Button type="primary" loading={linking} onClick={createLink}>Create hotspots</Button>
                  <Button onClick={() => setLink((current) => ({ ...current, from: null, to: null }))}>Cancel</Button>
                </Space>
              </Space>
            </Card>
          )}
        </Card>

        <div className="map-editor__side">
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
                  onClick={() => pickPin(scene._id)}
                >
                  <Space>
                    <EnvironmentOutlined />
                    <span>{scene.name}</span>
                  </Space>
                  <Space size={4}>
                    {Number.isFinite(scene.mapYawOffset) && <Tag color="blue" title="Map direction set">N</Tag>}
                    {scene.mapPosition ? <Tag color="green">Placed</Tag> : <Tag>Not placed</Tag>}
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card
            title="Map direction"
            className="map-editor__direction"
            extra={<Tag color={directionCount === scenes.length && scenes.length > 0 ? 'green' : 'default'}>{directionCount}/{scenes.length} set</Tag>}
          >
            {!selected ? (
              <p className="map-editor__muted">Select a scene to set which way its 360° view faces on the map.</p>
            ) : !selected.image ? (
              <p className="map-editor__muted">{selected.name} has no panorama yet.</p>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                <p className="map-editor__muted">
                  Turn the view of <strong>{selected.name}</strong> until the centre line faces the <strong>top of the floor plan</strong>, then set the direction.
                  {!Number.isFinite(selected.mapYawOffset) && (selected.hotspots || []).length > 0 && ' Without it, links use this scene\'s existing hotspots to work it out.'}
                </p>
                <div className="map-editor__direction-view">
                  <PanoramaViewer
                    key={selected._id}
                    scene={selected}
                    lookAt={Number.isFinite(selected.mapYawOffset) ? { yawDeg: (selected.mapYawOffset * 180) / Math.PI, key: `${selected._id}-dir` } : undefined}
                    onViewChange={(view) => { viewRef.current = view; }}
                  />
                  <div className="map-editor__north" aria-hidden="true"><span>↑ Top of floor plan</span></div>
                </div>
                <Space>
                  <Button type="primary" icon={<AimOutlined />} loading={settingDirection} onClick={() => saveDirection(viewRef.current.yaw)}>
                    Set direction
                  </Button>
                  {Number.isFinite(selected.mapYawOffset) && (
                    <Button onClick={() => saveDirection(null)} disabled={settingDirection}>Clear</Button>
                  )}
                  {Number.isFinite(selected.mapYawOffset) ? <Tag color="blue">Set</Tag> : <Tag>Not set</Tag>}
                </Space>
              </Space>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
