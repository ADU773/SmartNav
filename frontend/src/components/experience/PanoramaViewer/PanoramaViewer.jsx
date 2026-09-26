/**
 * SmartNav360 — PanoramaViewer
 * Marzipano viewer with hotspot support.
 *
 * The Marzipano viewer (a WebGL context plus a texture of the panorama) is
 * created once per scene image. Hotspots are drawn separately and redrawn in
 * place when they change, and the camera direction is carried across any
 * rebuild of the same scene. Previously the whole viewer was rebuilt whenever
 * a parent re-rendered with a new callback, which snapped the camera back to
 * its starting view every time a connection was added.
 */

import { useRef, useEffect, useState } from "react";
import Marzipano from "marzipano";

import {
  ExpandOutlined,
  AimOutlined,
  VideoCameraOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";

import { Button, Tooltip, Space } from "antd";

import "./PanoramaViewer.css";
import MiniMap from "../../map/MiniMap";
import { getImageUrl } from "../../../utils/getImageUrl";

const DEFAULT_FOV = (90 * Math.PI) / 180;

const PIN_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" /></svg>`;
const ROUTE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 22 20l-10-4-10 4L12 2Zm0 6.2-3.7 7.1 3.7-1.5 3.7 1.5L12 8.2Z" /></svg>`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} props
 * @param {object} props.scene
 * @param {(sceneId: string) => void} [props.onNavigate] - view mode: a pin was clicked
 * @param {boolean} [props.editMode]
 * @param {(coords: {yaw:number, pitch:number}) => void} [props.onPanoramaClick] - edit mode
 * @param {(hotspot: object, index: number) => void} [props.onHotspotSelect] - edit mode
 * @param {number|null} [props.selectedHotspotIndex] - edit mode: highlight this pin
 * @param {{yaw:number, pitch:number}|null} [props.pendingPin] - edit mode: an unsaved pin
 * @param {Map<string,string>} [props.targetNames] - scene id to name, for pin labels
 * @param {{ yawDeg: number, pitchDeg?: number, sceneId?: string, key: string|number }} [props.lookAt] -
 *   turns the camera once each time `key` changes, e.g. to face the direction
 *   a "Where am I?" photo was taken in
 * @param {object} [props.miniMap]
 * @param {string} [props.navigationTargetId]
 * @param {string} [props.navigationTargetName]
 */
export default function PanoramaViewer({
  scene,
  onNavigate,
  editMode = false,
  onPanoramaClick,
  onHotspotSelect,
  selectedHotspotIndex = null,
  pendingPin = null,
  targetNames,
  lookAt,
  miniMap,
  navigationTargetId,
  navigationTargetName,
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const sceneRef = useRef(null);
  const viewRef = useRef(null);
  const hotspotsRef = useRef([]);
  const viewerContainerRef = useRef(null);
  const animationFrameRef = useRef(null);
  // Last camera direction per scene, so rebuilding the same scene keeps it.
  const cameraBySceneRef = useRef(new Map());

  // Callbacks are read through refs so a parent passing inline functions does
  // not force the viewer to be torn down and rebuilt on every render.
  const callbacksRef = useRef({});
  callbacksRef.current = { onNavigate, onPanoramaClick, onHotspotSelect, editMode };

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [viewYaw, setViewYaw] = useState(0);

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === viewerContainerRef.current);
      // Marzipano must recalculate its canvas after the browser changes size.
      requestAnimationFrame(() => viewerRef.current?.updateSize?.());
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewerContainerRef.current?.requestFullscreen();
    } catch {
      // Fullscreen is unavailable in some embedded browsers.
    }
  };

  const resetView = () => {
    viewRef.current?.setParameters({ yaw: 0, pitch: 0, fov: DEFAULT_FOV });
  };

  /* ---- Viewer: created once per scene image ---- */
  const sceneId = scene?._id;
  const sceneImage = scene?.image;

  useEffect(() => {
    if (!sceneImage || !mountRef.current) return undefined;

    const viewer = new Marzipano.Viewer(mountRef.current);
    viewerRef.current = viewer;

    const source = Marzipano.ImageUrlSource.fromString(getImageUrl(sceneImage));
    const geometry = new Marzipano.EquirectGeometry([{ width: 4000 }]);
    const limiter = Marzipano.RectilinearView.limit.traditional(4096, (100 * Math.PI) / 180);

    const cameraByScene = cameraBySceneRef.current;
    const saved = cameraByScene.get(sceneId);
    const view = new Marzipano.RectilinearView(saved || { yaw: 0, pitch: 0, fov: DEFAULT_FOV }, limiter);
    viewRef.current = view;

    const updateMapHeading = () => {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => setViewYaw(view.yaw()));
    };
    view.addEventListener("change", updateMapHeading);
    updateMapHeading();

    const panoScene = viewer.createScene({ source, geometry, view });
    panoScene.switchTo();
    sceneRef.current = panoScene;

    const handleClick = (event) => {
      const { editMode: editing, onPanoramaClick: onClick } = callbacksRef.current;
      if (!editing || !onClick) return;
      const rect = mountRef.current.getBoundingClientRect();
      const coords = view.screenToCoordinates({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      if (coords) onClick(coords);
    };
    const element = viewer.domElement();
    element.addEventListener("click", handleClick);

    return () => {
      const { yaw, pitch, fov } = view.parameters();
      cameraByScene.set(sceneId, { yaw, pitch, fov });
      view.removeEventListener("change", updateMapHeading);
      element.removeEventListener("click", handleClick);
      cancelAnimationFrame(animationFrameRef.current);
      hotspotsRef.current = [];
      sceneRef.current = null;
      viewRef.current = null;
      viewerRef.current = null;
      // Releases the WebGL context; clearing innerHTML alone leaked one per scene.
      viewer.destroy();
    };
  }, [sceneId, sceneImage]);

  /* ---- Camera requests from the parent ---- */
  // Applied once per request, and only in the scene it was made for, so
  // walking to another scene and back does not re-apply a stale heading.
  const appliedLookAtRef = useRef(null);
  const lookAtKey = lookAt?.key;
  useEffect(() => {
    if (!lookAt || lookAtKey === undefined || appliedLookAtRef.current === lookAtKey) return;
    if (lookAt.sceneId && String(lookAt.sceneId) !== String(sceneId)) return;
    if (!viewRef.current) return;
    viewRef.current.setParameters({
      yaw: (lookAt.yawDeg * Math.PI) / 180,
      pitch: ((lookAt.pitchDeg || 0) * Math.PI) / 180,
    });
    appliedLookAtRef.current = lookAtKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookAtKey, sceneId, sceneImage]);

  /* ---- Hotspots: redrawn in place whenever they change ---- */
  const hotspots = scene?.hotspots;
  useEffect(() => {
    const panoScene = sceneRef.current;
    if (!panoScene) return undefined;
    const container = panoScene.hotspotContainer();

    const created = [];
    (hotspots || []).forEach((hotspot, hotspotIndex) => {
      const element = document.createElement("div");
      const isNextRouteStop = String(hotspot.targetScene) === String(navigationTargetId);
      const isSelected = editMode && hotspotIndex === selectedHotspotIndex;
      const targetName = targetNames?.get(String(hotspot.targetScene));
      const destination = hotspot.label || targetName || "location";

      element.className = [
        "smartnav-hotspot",
        isNextRouteStop && "smartnav-hotspot--route",
        editMode && "smartnav-hotspot--edit",
        isSelected && "smartnav-hotspot--selected",
      ].filter(Boolean).join(" ");

      const label = editMode ? `<span class="smartnav-hotspot__label">${escapeHtml(targetName || destination)}</span>` : "";
      element.innerHTML = isNextRouteStop
        ? `<span class="smartnav-hotspot__next">Next</span>${ROUTE_SVG}`
        : `${label}${PIN_SVG}`;

      element.title = editMode
        ? `Connection to ${targetName || destination} — click to edit`
        : isNextRouteStop ? `Next stop: ${navigationTargetName || destination}` : `Go to ${destination}`;
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", editMode ? `Edit connection to ${targetName || destination}` : `Navigate to ${destination}`);

      const activate = (event) => {
        event.stopPropagation();
        const { editMode: editing, onHotspotSelect: onSelect, onNavigate: onGo } = callbacksRef.current;
        if (editing) onSelect?.(hotspot, hotspotIndex);
        else onGo?.(hotspot.targetScene);
      };
      element.onclick = activate;
      element.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(event);
        }
      };

      created.push(container.createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch }));
    });

    if (editMode && pendingPin && Number.isFinite(pendingPin.yaw) && Number.isFinite(pendingPin.pitch)) {
      const element = document.createElement("div");
      element.className = "smartnav-hotspot smartnav-hotspot--pending";
      element.innerHTML = `<span class="smartnav-hotspot__label">New connection</span>${PIN_SVG}`;
      element.setAttribute("aria-hidden", "true");
      created.push(container.createHotspot(element, { yaw: pendingPin.yaw, pitch: pendingPin.pitch }));
    }

    hotspotsRef.current = created;
    return () => {
      // The scene may already be gone if the viewer was rebuilt first.
      if (sceneRef.current !== panoScene) return;
      for (const hotspot of created) container.destroyHotspot(hotspot);
    };
  }, [hotspots, sceneId, sceneImage, editMode, selectedHotspotIndex, pendingPin, targetNames, navigationTargetId, navigationTargetName]);

  return (
    <div ref={viewerContainerRef} className={`panorama-viewer ${editMode ? 'panorama-viewer--edit' : ''}`}>
      <div ref={mountRef} className="panorama-viewer__canvas" />

      {miniMap?.scenes?.length > 0 && showMiniMap && (
        <div className="panorama-viewer__minimap" aria-label="Live mini-map">
          <div className="panorama-viewer__minimap-header">
            <span><EnvironmentOutlined /> Live map · choose destination</span>
            <button type="button" onClick={() => setShowMiniMap(false)} aria-label="Hide live map">×</button>
          </div>
          <MiniMap {...miniMap} heading={viewYaw} />
        </div>
      )}

      <div className="panorama-viewer__toolbar">
        <Space>
          <Tooltip title="Reset view">
            <Button type="text" icon={<AimOutlined />} className="panorama-viewer__tool" onClick={resetView} aria-label="Reset view" />
          </Tooltip>

          <Tooltip title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <Button type="text" icon={<ExpandOutlined />} className="panorama-viewer__tool" onClick={toggleFullscreen} aria-label="Toggle fullscreen" />
          </Tooltip>

          {miniMap?.scenes?.length > 0 && !showMiniMap && (
            <Tooltip title="Show live map">
              <Button type="text" icon={<EnvironmentOutlined />} className="panorama-viewer__tool" onClick={() => setShowMiniMap(true)} />
            </Tooltip>
          )}

          <Tooltip title="VR Mode (Coming Soon)">
            <Button type="text" icon={<VideoCameraOutlined />} disabled className="panorama-viewer__tool" />
          </Tooltip>
        </Space>
      </div>
    </div>
  );
}
