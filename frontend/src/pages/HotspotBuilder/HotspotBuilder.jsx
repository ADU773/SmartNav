/**
 * SmartNav360 — Hotspot Builder Page
 *
 * Three steps, always visible: pick a scene, click the panorama where the
 * doorway is, choose where it leads. The editor sits beside the panorama, not
 * in a modal, so the pin being placed stays in view.
 *
 * Existing pins open an editor (label, access, distance, move, delete, go to
 * destination) instead of deleting on click. New connections can create their
 * way back in the same step. Esc cancels whatever is in progress.
 */
import { useProject } from "../../contexts/ProjectContext";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Collapse, Empty, Row, Spin, Steps, Tag, Tooltip } from 'antd';
import {
  AimOutlined,
  ArrowRightOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
  LoginOutlined,
  NodeIndexOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNotification } from '../../contexts/NotificationContext';
import { MESSAGES } from '../../constants/messages';
import SceneService from '../../services/scene.service';
import UploadService from '../../services/upload.service';
import { buildPreviewIndex, scenePreviewUrl } from '../../utils/imagePreview';
import { incomingCounts, linksTo, reverseDirection, unreachableScenes } from '../../utils/sceneGraph';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import HotspotTable from '../../components/hotspots/HotspotTable';
import ConnectionEditor from '../../components/hotspots/ConnectionEditor';
import EmptyState from '../../components/common/EmptyState';
import PanoramaViewer from '../../components/experience/PanoramaViewer';
import './HotspotBuilder.css';

/** Strips a hotspot to the fields the API accepts on update. */
const toPayload = ({ _id, targetScene, label, yaw, pitch, distance, access }) => ({
  ...(_id ? { _id } : {}),
  targetScene: String(targetScene),
  label: label || '',
  yaw: Number.isFinite(yaw) ? yaw : 0,
  pitch: Number.isFinite(pitch) ? pitch : 0,
  distance: Number.isFinite(distance) ? distance : 0,
  access: access || 'flat',
});

export default function HotspotBuilder() {
  useDocumentTitle('Hotspots');
  const { currentProject } = useProject();
  const { success, error, warning } = useNotification();

  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSceneId, setSelectedSceneId] = useState(null);

  // Editor state: nothing, a new pin being composed, or an existing one open.
  const [mode, setMode] = useState('idle'); // idle | create | edit
  const [pendingPin, setPendingPin] = useState(null);
  const [editIndex, setEditIndex] = useState(null);
  const [moving, setMoving] = useState(false);
  const viewerCardRef = useRef(null);

  const selectedScene = useMemo(() => scenes.find((s) => s._id === selectedSceneId) || null, [scenes, selectedSceneId]);
  const previewIndex = useMemo(() => buildPreviewIndex(assets), [assets]);
  const targetNames = useMemo(() => new Map(scenes.map((s) => [s._id, s.name])), [scenes]);
  const incoming = useMemo(() => incomingCounts(scenes), [scenes]);
  const unreachable = useMemo(() => unreachableScenes(scenes), [scenes]);
  const editingHotspot = mode === 'edit' && editIndex !== null ? selectedScene?.hotspots?.[editIndex] || null : null;

  const resetEditor = useCallback(() => {
    setMode('idle');
    setPendingPin(null);
    setEditIndex(null);
    setMoving(false);
  }, []);

  const loadScenes = useCallback(async (preferredSceneId) => {
    if (!currentProject?._id) {
      setScenes([]);
      setSelectedSceneId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await SceneService.getScenes(currentProject._id);
      const data = result.data || [];
      setScenes(data);
      setSelectedSceneId((current) => {
        const target = preferredSceneId || current;
        return data.find((scene) => scene._id === target)?._id || data[0]?._id || null;
      });
    } catch (err) {
      error(MESSAGES.SCENE_LOAD_ERROR, err.message);
    } finally {
      setLoading(false);
    }
  }, [currentProject?._id, error]);

  useEffect(() => {
    loadScenes();
    if (!currentProject?._id) return;
    // Thumbnails only; the page works without them.
    UploadService.getUploads(currentProject._id)
      .then((result) => setAssets(result.data || []))
      .catch(() => setAssets([]));
  }, [currentProject?._id, loadScenes]);

  // Esc backs out of whatever is in progress.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (moving) setMoving(false);
      else if (mode !== 'idle') resetEditor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, moving, resetEditor]);

  const selectScene = (sceneId) => {
    resetEditor();
    setSelectedSceneId(sceneId);
  };

  const saveHotspots = async (sceneId, hotspots) => {
    const result = await SceneService.updateScene(sceneId, { hotspots: hotspots.map(toPayload) });
    if (!result.success) throw new Error(result.message || MESSAGES.CONNECTION_ERROR);
    return result;
  };

  /* ---- Panorama clicks ---- */
  const handlePanoramaClick = async (coords) => {
    if (!selectedScene) return;
    if (moving && editingHotspot) {
      const hotspots = selectedScene.hotspots.map((spot, i) => (i === editIndex ? { ...spot, yaw: coords.yaw, pitch: coords.pitch } : spot));
      try {
        await saveHotspots(selectedScene._id, hotspots);
        success('Pin moved');
        setMoving(false);
        await loadScenes(selectedScene._id);
      } catch (err) {
        error('Could not move the pin', err.message);
      }
      return;
    }
    if (scenes.length < 2) {
      warning('Add another scene first', 'A connection needs somewhere to lead. Create a second scene in Scene Builder.');
      return;
    }
    setEditIndex(null);
    setMoving(false);
    setPendingPin(coords);
    setMode('create');
  };

  const handleHotspotSelect = (_hotspot, index) => {
    setPendingPin(null);
    setMoving(false);
    setEditIndex(index);
    setMode('edit');
  };

  /* ---- Editor actions ---- */
  const createConnection = async ({ targetSceneId, label, access, distance, wayBack }) => {
    const source = selectedScene;
    const target = scenes.find((s) => s._id === targetSceneId);
    const pin = pendingPin || { yaw: 0, pitch: 0 };
    const base = { access: access || 'flat', distance: Number.isFinite(distance) ? distance : 0 };
    try {
      await SceneService.connectScenes(source._id, {
        targetSceneId,
        label: label || `Go to ${target?.name || 'next scene'}`,
        yaw: pin.yaw,
        pitch: pin.pitch,
        ...base,
      });
    } catch (err) {
      error(MESSAGES.CONNECTION_ERROR, err.message);
      return;
    }

    let twoWay = false;
    if (wayBack && target && !linksTo(target, source._id)) {
      const back = reverseDirection(pin);
      try {
        await SceneService.connectScenes(target._id, {
          targetSceneId: source._id,
          label: `Back to ${source.name}`,
          yaw: back.yaw,
          pitch: back.pitch,
          ...base,
        });
        twoWay = true;
      } catch (err) {
        warning(
          `Connected ${source.name} to ${target.name}, but not the way back`,
          `${err.message} You can add it from ${target.name}.`,
        );
      }
    }

    success(
      twoWay ? `${source.name} and ${target.name} are connected both ways` : MESSAGES.CONNECTION_ADDED,
      twoWay ? `The way back was placed facing the opposite direction in ${target.name}. Open it to adjust the pin if needed.` : undefined,
    );
    resetEditor();
    await loadScenes(source._id);
  };

  const saveConnection = async ({ label, access, distance }) => {
    const hotspots = selectedScene.hotspots.map((spot, i) => (i === editIndex ? { ...spot, label, access, distance } : spot));
    try {
      await saveHotspots(selectedScene._id, hotspots);
      success('Connection updated');
      await loadScenes(selectedScene._id);
    } catch (err) {
      error('Could not save the connection', err.message);
    }
  };

  const deleteConnection = async ({ removeWayBack }) => {
    const source = selectedScene;
    const targetId = String(editingHotspot.targetScene);
    try {
      await saveHotspots(source._id, source.hotspots.filter((_, i) => i !== editIndex));
      if (removeWayBack) {
        const target = scenes.find((s) => s._id === targetId);
        if (target) await saveHotspots(target._id, target.hotspots.filter((spot) => String(spot.targetScene) !== source._id));
      }
      success(MESSAGES.CONNECTION_REMOVED, removeWayBack ? 'The way back was removed too.' : undefined);
      resetEditor();
      await loadScenes(source._id);
    } catch (err) {
      error(MESSAGES.CONNECTION_DELETE_ERROR, err.message);
    }
  };

  const addWayBack = async () => {
    const source = selectedScene;
    const target = scenes.find((s) => s._id === String(editingHotspot.targetScene));
    if (!target) return;
    const back = reverseDirection(editingHotspot);
    try {
      await SceneService.connectScenes(target._id, {
        targetSceneId: source._id,
        label: `Back to ${source.name}`,
        yaw: back.yaw,
        pitch: back.pitch,
        access: editingHotspot.access || 'flat',
        distance: editingHotspot.distance || 0,
      });
      success(`Added a way back from ${target.name}`);
      await loadScenes(source._id);
    } catch (err) {
      error('Could not add the way back', err.message);
    }
  };

  const openScene = (sceneId) => {
    selectScene(sceneId);
    viewerCardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  /* ---- Guidance ---- */
  const step = !selectedScene ? 0 : mode === 'create' ? 2 : 1;
  const totalConnections = scenes.reduce((acc, s) => acc + (s.hotspots?.length || 0), 0);
  const outgoing = selectedScene?.hotspots || [];
  const incomingFrom = selectedScene ? scenes.filter((s) => linksTo(s, selectedScene._id)) : [];

  if (!currentProject) {
    return <Empty description="Choose a project to connect its scenes." />;
  }

  return (
    <div className="hotspot-builder">
      <WorkspaceHeader
        title="Hotspot Builder"
        description="Link scenes together so visitors can walk from one to the next."
        actions={
          <Tooltip title={scenes.length < 2 ? 'Create at least two scenes first' : 'Then click the panorama where the doorway is'}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!selectedScene || scenes.length < 2}
              onClick={() => { resetEditor(); setMode('placing'); }}
            >
              Add connection
            </Button>
          </Tooltip>
        }
      />

      {scenes.length > 0 && (
        <Steps
          size="small"
          current={step}
          className="hotspot-builder__steps"
          items={[
            { title: 'Pick a scene', content: selectedScene ? selectedScene.name : 'From the strip below' },
            { title: 'Click the doorway', content: 'On the panorama' },
            { title: 'Choose where it leads', content: 'In the side panel' },
          ]}
        />
      )}

      {unreachable.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          className="hotspot-builder__alert"
          title={`${unreachable.length} scene${unreachable.length === 1 ? ' is' : 's are'} not reachable from ${scenes[0].name}`}
          description={
            <span className="hotspot-builder__unreachable">
              Visitors starting at {scenes[0].name} can never get to:
              {unreachable.map((scene) => (
                <Button key={scene._id} size="small" type="link" onClick={() => openScene(scene._id)}>
                  {scene.name}
                </Button>
              ))}
            </span>
          }
        />
      )}

      {scenes.length > 0 && (
        <div className="hotspot-builder__scene-strip" role="tablist" aria-label="Scenes">
          {scenes.map((scene) => {
            const out = scene.hotspots?.length || 0;
            const inn = incoming.get(scene._id) || 0;
            const isActive = scene._id === selectedScene?._id;
            const isolated = out === 0 && inn === 0 && scenes.length > 1;
            const preview = scenePreviewUrl(scene, previewIndex);
            return (
              <button
                key={scene._id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`hotspot-builder__scene-chip ${isActive ? 'is-active' : ''} ${isolated ? 'is-isolated' : ''}`}
                onClick={() => selectScene(scene._id)}
              >
                <span
                  className="hotspot-builder__scene-chip-thumb"
                  style={{ backgroundImage: preview ? `url(${preview})` : 'none' }}
                />
                <span className="hotspot-builder__scene-chip-info">
                  <span className="hotspot-builder__scene-chip-name">{scene.name}</span>
                  <span className="hotspot-builder__scene-chip-count">
                    {isolated ? (
                      <span className="hotspot-builder__isolated">Not connected</span>
                    ) : (
                      <>
                        <Tooltip title="Connections leading out"><span><ArrowRightOutlined /> {out}</span></Tooltip>
                        <Tooltip title="Connections leading in"><span><LoginOutlined /> {inn}</span></Tooltip>
                      </>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            ref={viewerCardRef}
            title={selectedScene ? selectedScene.name : 'Panorama Editor'}
            className="hotspot-builder__viewer-card"
          >
            {selectedScene ? (
              <>
                <div className={`hotspot-builder__hint ${mode === 'placing' || moving ? 'is-emphasised' : ''}`}>
                  <AimOutlined />
                  {moving
                    ? 'Click the new position for this connection. Esc cancels.'
                    : mode === 'placing'
                      ? 'Click on the panorama where the doorway or path is.'
                      : 'Click anywhere on the panorama to add a connection there. Click a pin to edit it.'}
                </div>
                {selectedScene.image ? (
                  <PanoramaViewer
                    scene={selectedScene}
                    editMode
                    onPanoramaClick={handlePanoramaClick}
                    onHotspotSelect={handleHotspotSelect}
                    selectedHotspotIndex={mode === 'edit' ? editIndex : null}
                    pendingPin={mode === 'create' ? pendingPin : null}
                    targetNames={targetNames}
                  />
                ) : (
                  <EmptyState
                    icon={EnvironmentOutlined}
                    title="This scene has no panorama"
                    description="Give it an image in Scene Builder before placing connections."
                  />
                )}
              </>
            ) : (
              <EmptyState
                icon={NodeIndexOutlined}
                title="No scenes yet"
                description="Create scenes in the Scene Builder, then link them here."
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="hotspot-builder__panel">
            <Spin spinning={loading}>
              {selectedScene && (mode === 'create' || mode === 'edit') && (mode !== 'edit' || editingHotspot) ? (
                <ConnectionEditor
                  mode={mode}
                  sourceScene={selectedScene}
                  scenes={scenes}
                  hotspot={editingHotspot}
                  moving={moving}
                  previewIndex={previewIndex}
                  onCreate={createConnection}
                  onSave={saveConnection}
                  onDelete={deleteConnection}
                  onAddWayBack={addWayBack}
                  onMove={() => setMoving(true)}
                  onOpenScene={openScene}
                  onCancel={resetEditor}
                />
              ) : selectedScene ? (
                <div className="hotspot-builder__overview">
                  <h3>Leads to</h3>
                  {outgoing.length === 0 ? (
                    <p className="hotspot-builder__muted">No connections yet. Click the panorama to add one.</p>
                  ) : (
                    <ul className="hotspot-builder__links">
                      {outgoing.map((spot, index) => {
                        const target = scenes.find((s) => s._id === String(spot.targetScene));
                        return (
                          <li key={spot._id || index}>
                            <button type="button" onClick={() => handleHotspotSelect(spot, index)}>
                              <span
                                className="hotspot-builder__link-thumb"
                                style={{ backgroundImage: target ? `url(${scenePreviewUrl(target, previewIndex)})` : 'none' }}
                              />
                              <span className="hotspot-builder__link-text">
                                <span>{target?.name || 'Deleted scene'}</span>
                                <small>{spot.label || 'No label'}</small>
                              </span>
                              {target && linksTo(target, selectedScene._id)
                                ? <Tag color="green">Two-way</Tag>
                                : <Tag color="orange">One-way</Tag>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <h3>Reachable from</h3>
                  {incomingFrom.length === 0 ? (
                    <p className="hotspot-builder__muted">No scene leads here yet.</p>
                  ) : (
                    <div className="hotspot-builder__from">
                      {incomingFrom.map((scene) => (
                        <Button key={scene._id} size="small" icon={<LinkOutlined />} onClick={() => openScene(scene._id)}>
                          {scene.name}
                        </Button>
                      ))}
                    </div>
                  )}

                  <div className="hotspot-builder__totals">
                    <span><strong>{scenes.length}</strong> scenes</span>
                    <span><strong>{totalConnections}</strong> connections</span>
                    <span><strong>{scenes.length - unreachable.length}</strong> reachable</span>
                  </div>
                </div>
              ) : (
                <p className="hotspot-builder__muted">Select a scene to see its connections.</p>
              )}
            </Spin>
          </Card>
        </Col>
      </Row>

      {totalConnections > 0 && (
        <Collapse
          className="hotspot-builder__all"
          items={[{
            key: 'all',
            label: `All connections (${totalConnections})`,
            children: (
              <HotspotTable
                scenes={scenes}
                loading={loading}
                onDelete={(record) => {
                  selectScene(record.sourceSceneId);
                  setEditIndex(record.hotspotIndex);
                  setMode('edit');
                }}
                onLocate={(record) => {
                  selectScene(record.sourceSceneId);
                  setEditIndex(record.hotspotIndex);
                  setMode('edit');
                  viewerCardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                }}
              />
            ),
          }]}
        />
      )}
    </div>
  );
}
