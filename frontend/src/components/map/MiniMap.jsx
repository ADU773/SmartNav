import { EnvironmentOutlined } from '@ant-design/icons';
import { getImageUrl } from '../../utils/getImageUrl';
import './MiniMap.css';

const positionFor = (scene, index) => scene.mapPosition || { x: 20 + ((index * 23) % 60), y: 25 + ((index * 31) % 50) };

export default function MiniMap({ floorPlan, scenes = [], activeSceneId, onSelect, interactive = false, onPlace, heading = 0 }) {
  const byId = new Map(scenes.map((scene, index) => [String(scene._id), { ...scene, position: positionFor(scene, index) }]));
  const handleMapClick = (event) => {
    if (!interactive || !onPlace) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPlace({ x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)) });
  };
  return <div className={`mini-map ${interactive ? 'mini-map--interactive' : ''}`} onClick={handleMapClick} role={interactive ? 'application' : undefined}>
    {floorPlan ? <img className="mini-map__image" src={getImageUrl(floorPlan)} alt="Project floor plan" /> : <div className="mini-map__empty"><EnvironmentOutlined /><span>Add a floor plan image in Map Editor</span></div>}
    <svg className="mini-map__routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {scenes.flatMap((scene, index) => (scene.hotspots || []).map((spot, routeIndex) => {
        const source = positionFor(scene, index); const target = byId.get(String(spot.targetScene))?.position;
        return target ? <line key={`${scene._id}-${routeIndex}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
      }))}
    </svg>
    {scenes.map((scene, index) => {
      const position = positionFor(scene, index); const active = String(scene._id) === String(activeSceneId);
      return <button key={scene._id} type="button" title={scene.name} aria-label={`${scene.name}${active ? ', current location' : ''}`} onClick={(event) => { event.stopPropagation(); onSelect?.(scene._id); }} className={`mini-map__pin ${active ? 'mini-map__pin--active' : ''}`} style={{ left: `${position.x}%`, top: `${position.y}%` }}><EnvironmentOutlined />{active && <i className="mini-map__heading" style={{ '--heading': `${heading * 180 / Math.PI}deg` }} aria-hidden="true" />}<span>{scene.name}</span></button>;
    })}
  </div>;
}
