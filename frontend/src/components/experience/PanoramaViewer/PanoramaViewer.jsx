/**
 * SmartNav360 — PanoramaViewer
 * Marzipano Viewer with Hotspot Support
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

export default function PanoramaViewer({
  scene,
  onNavigate,
  editMode = false,
  onPanoramaClick,
  onHotspotSelect,
  miniMap,
  navigationTargetId,
  navigationTargetName,
}) {
  const mountRef = useRef(null);

  const viewerRef = useRef(null);

  const sceneRef = useRef(null);
  const viewerContainerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [viewYaw, setViewYaw] = useState(0);
  const animationFrameRef = useRef(null);

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

  const handleViewerClick = (event) => {

    if (!viewerRef.current) return;

    const rect = mountRef.current.getBoundingClientRect();

    const coords = viewerRef.current
      .view()
      .screenToCoordinates({

        x: event.clientX - rect.left,

        y: event.clientY - rect.top

      });

    console.log(coords);

    if (onPanoramaClick) {

      onPanoramaClick(coords);

    }

  };


  useEffect(() => {
    if (!scene) return;
    if (!scene.image) return;
    if (!mountRef.current) return;

    // Clear previous viewer
    mountRef.current.innerHTML = "";

    // Create viewer
    const viewer = new Marzipano.Viewer(mountRef.current);
    viewerRef.current = viewer;

    // Image URL
    const imageUrl = getImageUrl(scene.image);

    // Image Source
    const source = Marzipano.ImageUrlSource.fromString(imageUrl);

    // Geometry
    const geometry = new Marzipano.EquirectGeometry([
      {
        width: 4000,
      },
    ]);

    // View Limiter
    const limiter =
      Marzipano.RectilinearView.limit.traditional(
        4096,
        (100 * Math.PI) / 180
      );

    // Camera View
    const view = new Marzipano.RectilinearView(null, limiter);
    const updateMapHeading = () => {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => setViewYaw(view.yaw()));
    };
    view.addEventListener("change", updateMapHeading);
    updateMapHeading();

    // Create Scene
    const panoScene = viewer.createScene({
      source,
      geometry,
      view,
    });

    panoScene.switchTo();

    sceneRef.current = panoScene;

    if (editMode) {

      viewer.domElement().addEventListener("click", handleViewerClick);

    }
    // -----------------------------
    // Create Hotspots
    // -----------------------------
    if (scene.hotspots && scene.hotspots.length > 0) {
      scene.hotspots.forEach((hotspot, hotspotIndex) => {
        const element = document.createElement("div");
        const isNextRouteStop = String(hotspot.targetScene) === String(navigationTargetId);

        element.className = `smartnav-hotspot ${isNextRouteStop ? "smartnav-hotspot--route" : ""} ${editMode ? "smartnav-hotspot--edit" : ""}`;

        // Inline SVG keeps the navigation location marker crisp at every zoom level.
        element.innerHTML = isNextRouteStop
          ? `<span class="smartnav-hotspot__next">Next</span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 22 20l-10-4-10 4L12 2Zm0 6.2-3.7 7.1 3.7-1.5 3.7 1.5L12 8.2Z" /></svg>`
          : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" /></svg>`;

        const destination = hotspot.label || "location";
        element.title = editMode ? `Connection to ${destination} — click to remove` : (isNextRouteStop ? `Next stop: ${navigationTargetName || destination}` : `Go to ${destination}`);
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", editMode ? `Remove connection to ${destination}` : `Navigate to ${destination}`);

        element.onclick = (event) => {
          event.stopPropagation();
          if (editMode) {
            onHotspotSelect?.(hotspot, hotspotIndex);
          } else if (onNavigate) {
            onNavigate(hotspot.targetScene);
          }
        };

        panoScene.hotspotContainer().createHotspot(element, {
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
        });
      });
    }

    // Cleanup
    return () => {
      view.removeEventListener("change", updateMapHeading);
      cancelAnimationFrame(animationFrameRef.current);
      if (mountRef.current) {
        mountRef.current.innerHTML = "";
      }
    };
  }, [scene, onNavigate, editMode, onHotspotSelect, navigationTargetId, navigationTargetName]);

  return (
    <div ref={viewerContainerRef} className={`panorama-viewer ${editMode ? 'panorama-viewer--edit' : ''}`}>
      {/* Marzipano Mount */}
      <div
        ref={mountRef}
        className="panorama-viewer__canvas"
      />

      {miniMap?.scenes?.length > 0 && showMiniMap && (
        <div className="panorama-viewer__minimap" aria-label="Live mini-map">
          <div className="panorama-viewer__minimap-header">
            <span><EnvironmentOutlined /> Live map · choose destination</span>
            <button type="button" onClick={() => setShowMiniMap(false)} aria-label="Hide live map">×</button>
          </div>
          <MiniMap {...miniMap} heading={viewYaw} />
        </div>
      )}

      {/* Toolbar */}
      <div className="panorama-viewer__toolbar">
        <Space>
          <Tooltip title="Reset View">
            <Button
              type="text"
              icon={<AimOutlined />}
              className="panorama-viewer__tool"
            />
          </Tooltip>

          <Tooltip title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <Button
              type="text"
              icon={<ExpandOutlined />}
              className="panorama-viewer__tool"
              onClick={toggleFullscreen}
            />
          </Tooltip>

          {miniMap?.scenes?.length > 0 && !showMiniMap && (
            <Tooltip title="Show live map">
              <Button type="text" icon={<EnvironmentOutlined />} className="panorama-viewer__tool" onClick={() => setShowMiniMap(true)} />
            </Tooltip>
          )}

          <Tooltip title="VR Mode (Coming Soon)">
            <Button
              type="text"
              icon={<VideoCameraOutlined />}
              disabled
              className="panorama-viewer__tool"
            />
          </Tooltip>
        </Space>
      </div>
    </div>
  );
}
