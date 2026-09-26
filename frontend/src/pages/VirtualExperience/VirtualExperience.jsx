/**
 * SmartNav360 — Virtual Experience Page
 * Centrepiece of SmartNav360 — Three-panel layout with panorama viewer.
 */
import { useProject } from "../../contexts/ProjectContext";
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { List, Tag, Button, Divider, Select, Alert } from 'antd';
import {
  EyeOutlined,
  NodeIndexOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ACCESS_MODES } from '../../constants/access';
import SceneService from '../../services/scene.service';
import PanoramaViewer from '../../components/experience/PanoramaViewer';
import EmptyState from '../../components/common/EmptyState';
import AIService from '../../services/ai.service';
import FeatureService from '../../services/feature.service';
import ProjectService from '../../services/project.service';
import './VirtualExperience.css';
import WhereAmI from '../../components/experience/WhereAmI';

export default function VirtualExperience() {
  useDocumentTitle('Virtual Experience');

  const location = useLocation();
  const { currentProject } = useProject();
  const [scenes, setScenes] = useState([]);
  const [selectedScene, setSelectedScene] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeTarget, setRouteTarget] = useState();
  // Access modes the visitor cannot or would rather not use. Excluded modes are
  // removed from the graph server-side, so a step-free route really is one.
  const [avoidModes, setAvoidModes] = useState([]);
  const [route, setRoute] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detections, setDetections] = useState([]);
  const [sharedProject, setSharedProject] = useState(null);
  const [projectDetails, setProjectDetails] = useState(null);
  // Set by "Where am I?": the viewer turns to face the way the photo was taken.
  const [lookAt, setLookAt] = useState(null);
  const shareToken = new URLSearchParams(location.search).get('share');
  const activeProject = sharedProject || currentProject;
  const floorPlan = sharedProject?.floorPlan || projectDetails?.floorPlan || currentProject?.floorPlan;
  const routeIds = route?.path?.map((scene) => String(scene._id)) || [];
  const currentRouteIndex = routeIds.indexOf(String(selectedScene?._id));
  const nextRouteSceneId = currentRouteIndex >= 0 ? routeIds[currentRouteIndex + 1] : undefined;
  const nextRouteScene = scenes.find((scene) => String(scene._id) === nextRouteSceneId);

  const sessionId = (() => {
    const key = 'smartnav360_session_id';
    let value = localStorage.getItem(key);
    if (!value) { value = crypto.randomUUID?.() || String(Date.now()); localStorage.setItem(key, value); }
    return value;
  })();

  useEffect(() => {
    if (!activeProject && !shareToken) return;
    const loadScenes = async () => {
      try {
        const result = shareToken ? await FeatureService.getPublishedProject(shareToken) : await SceneService.getScenes(activeProject._id);
        if (result.success) {
          const data = shareToken ? result.data.scenes : result.data || [];
          if (shareToken) setSharedProject(result.data.project);
          setScenes(data);

          // Auto-select scene from navigation state
          const targetId = location.state?.selectedSceneId;
          if (targetId) {
            const target = data.find((s) => s._id === targetId);
            if (target) setSelectedScene(target);
          } else if (data.length > 0) {
            setSelectedScene(data[0]);
          }
        }
      } catch {
        // Handled by error boundary
      } finally {
        setLoading(false);
      }
    };
    loadScenes();
}, [location.state, activeProject?._id, shareToken]);

  const handleNavigate = (sceneId) => {
    const scene = scenes.find((s) => s._id === sceneId);
    if (scene) {
      FeatureService.trackEvent({ projectId: activeProject?._id, sceneId, type: 'navigation', sessionId, metadata: { fromSceneId: selectedScene?._id } }).catch(() => {});
      setSelectedScene(scene);
    }
  };

  useEffect(() => {
    if (selectedScene?._id && activeProject?._id) FeatureService.trackEvent({ projectId: activeProject._id, sceneId: selectedScene._id, type: 'view', sessionId }).catch(() => {});
  }, [selectedScene?._id, activeProject?._id]);

  useEffect(() => {
    if (shareToken || !currentProject?._id) return;
    ProjectService.getProject(currentProject._id).then((result) => setProjectDetails(result.data)).catch(() => {});
  }, [currentProject?._id, shareToken]);

  const findRoute = async (destinationId = routeTarget, avoid = avoidModes) => {
    if (!selectedScene?._id || !destinationId || destinationId === selectedScene._id) return;
    setRouteTarget(destinationId);
    try {
      const result = await AIService.getNavigationPath(activeProject._id, selectedScene._id, destinationId, avoid);
      setRoute({ ...result.data, destinationId });
    } catch (error) { setRoute({ error: error.message || 'No route found.', destinationId }); }
  };

  // Relocation, not navigation: the visitor did not walk a connection, so no
  // navigation event is recorded. The view event fires as usual.
  const startHere = (sceneId, yawDeg) => {
    const scene = scenes.find((item) => String(item._id) === String(sceneId));
    if (!scene) return;
    setSelectedScene(scene);
    setLookAt({ sceneId: scene._id, yawDeg, key: Date.now() });
  };

  const clearRoute = () => { setRoute(null); setRouteTarget(undefined); };
  const chooseMapDestination = (sceneId) => findRoute(sceneId);

  const detectObjects = async () => {
    if (!selectedScene?._id) return;
    setDetecting(true);
    try { const result = await FeatureService.detectObjects(selectedScene._id); setDetections(result.data.labels || []); }
    catch (error) { setDetections([error.message || 'Detection service is unavailable.']); }
    finally { setDetecting(false); }
  };

  if (scenes.length === 0 && !loading) {
    return (
      <div className="virtual-experience">
        <EmptyState
          icon={EyeOutlined}
          title="No scenes available"
          description="Create scenes in the Scene Builder to begin the virtual experience."
        />
      </div>
    );
  }

  return (
    <div className="virtual-experience">
      {/* Left Sidebar — Scene List */}
      <aside className="virtual-experience__sidebar virtual-experience__sidebar--left">
        <div className="virtual-experience__sidebar-header">
          <h3>Scenes</h3>
          <Tag>{scenes.length}</Tag>
        </div>
        <div className="virtual-experience__where">
          <WhereAmI
            projectId={shareToken ? undefined : activeProject?._id}
            shareToken={shareToken || undefined}
            onStartHere={startHere}
          />
        </div>
        <List
          dataSource={scenes}
          loading={loading}
          size="small"
          renderItem={(scene) => (
            <List.Item
              className={`virtual-experience__scene-item ${selectedScene?._id === scene._id ? 'virtual-experience__scene-item--active' : ''
                }`}
              onClick={() => handleNavigate(scene._id)}
            >
              <div className="virtual-experience__scene-name">
                <EyeOutlined />
                <span>{scene.name}</span>
              </div>
              {scene.hotspots?.length > 0 && (
                <Tag className="virtual-experience__scene-tag">
                  {scene.hotspots.length}
                </Tag>
              )}
            </List.Item>
          )}
        />
      </aside>

      {/* Center — Panorama Viewer */}
      <main className="virtual-experience__viewer">
        <PanoramaViewer
          scene={selectedScene}
          onNavigate={handleNavigate}
          navigationTargetId={nextRouteSceneId}
          navigationTargetName={nextRouteScene?.name}
          lookAt={lookAt}
          miniMap={{ floorPlan, scenes, activeSceneId: selectedScene?._id, onSelect: chooseMapDestination, routePath: routeIds, routeDistance: route?.distance, onClearRoute: clearRoute }}
        />
      </main>

      {/* Right Sidebar — Scene Info */}
      <aside className="virtual-experience__sidebar virtual-experience__sidebar--right">
        <div className="virtual-experience__sidebar-header">
          <h3>Scene Info</h3>
        </div>

        {selectedScene ? (
          <div className="virtual-experience__info">
            <div className="virtual-experience__info-item">
              <span className="virtual-experience__info-label">Name</span>
              <span className="virtual-experience__info-value">{selectedScene.name}</span>
            </div>

            <Divider />

            <div className="virtual-experience__info-section">
              <h4><EyeOutlined /> YOLO object detection</h4>
              <Button size="small" loading={detecting} disabled={!selectedScene.image} onClick={detectObjects}>Detect objects</Button>
              <div style={{ marginTop: 8 }}>{detections.map((label) => <Tag key={label}>{label}</Tag>)}</div>
              {!selectedScene.image && <p className="virtual-experience__no-data">Add a panorama image before running detection.</p>}
            </div>

            <Divider />

            <div className="virtual-experience__info-section">
              <h4>
                <NodeIndexOutlined /> Connections ({selectedScene.hotspots?.length || 0})
              </h4>
              {selectedScene.hotspots?.length > 0 ? (
                <List
                  size="small"
                  dataSource={selectedScene.hotspots}
                  renderItem={(hotspot) => {
                    const target = scenes.find(
                      (s) => s._id === hotspot.targetScene
                    );
                    return (
                      <List.Item
                        className="virtual-experience__hotspot-item"
                        onClick={() => handleNavigate(hotspot.targetScene)}
                      >
                        <span>{hotspot.label || target?.name || 'Unknown'}</span>
                        <Button type="link" size="small">Go →</Button>
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <p className="virtual-experience__no-data">No connections</p>
              )}
            </div>

            <Divider />

            <div className="virtual-experience__info-section">
              <h4><InfoCircleOutlined /> Shortest path</h4>
              <Select size="small" style={{ width: '100%', marginBottom: 8 }} placeholder="Choose destination" value={routeTarget} onChange={setRouteTarget} options={scenes.filter((scene) => scene._id !== selectedScene._id).map((scene) => ({ value: scene._id, label: scene.name }))} />
              <Select
                size="small"
                mode="multiple"
                allowClear
                style={{ width: '100%', marginBottom: 8 }}
                placeholder="Avoid (optional)"
                value={avoidModes}
                onChange={(modes) => { setAvoidModes(modes); if (routeTarget) findRoute(routeTarget, modes); }}
                options={ACCESS_MODES.map((mode) => ({ value: mode.value, label: `Avoid ${mode.label.toLowerCase()}` }))}
              />
              <Button size="small" type="primary" disabled={!routeTarget} onClick={() => findRoute()}>Find route</Button>
              {route?.path && <Button size="small" style={{ marginLeft: 8 }} onClick={clearRoute}>Clear route</Button>}
              {route?.error && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={route.error} />}
              {route?.path && (
                <div style={{ marginTop: 8 }}>
                  <p className="virtual-experience__no-data">
                    Route: {route.path.map((scene) => scene.name).join(' → ')} · cost {Math.round(route.distance)}
                    {nextRouteScene ? ` · Next: ${nextRouteScene.name}` : ' · Destination reached'}
                  </p>
                  {route.avoided?.length > 0 && (
                    <p className="virtual-experience__no-data">Step-free: avoids {route.avoided.join(', ')}.</p>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {route.path.filter((step) => step.access).map((step) => (
                      <Tag key={step._id} color={step.access === 'stairs' ? 'orange' : 'default'}>{step.access}</Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="virtual-experience__no-data" style={{ padding: 16 }}>
            Select a scene to view details
          </p>
        )}
      </aside>
    </div>
  );
}
