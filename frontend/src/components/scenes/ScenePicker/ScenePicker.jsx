/**
 * SmartNav360 — ScenePicker
 * Chooses a destination scene by its picture rather than its name. Scenes the
 * source already links to are shown but disabled, because the API rejects a
 * second connection to the same destination.
 *
 * Controlled antd form control: `value` / `onChange` carry a scene ID.
 */

import { useMemo, useState } from 'react';
import { Input } from 'antd';
import { CheckCircleFilled, LinkOutlined, PictureOutlined, SearchOutlined } from '@ant-design/icons';
import { scenePreviewUrl } from '../../../utils/imagePreview';
import './ScenePicker.css';

/**
 * @param {object} props
 * @param {object[]} props.scenes
 * @param {string} [props.value]
 * @param {(sceneId: string) => void} [props.onChange]
 * @param {string} [props.excludeId] - the source scene; never a valid destination
 * @param {string[]} [props.linkedIds] - destinations the source already links to
 * @param {Map<string,string>} [props.previewIndex] - from buildPreviewIndex
 */
export default function ScenePicker({ scenes = [], value, onChange, excludeId, linkedIds = [], previewIndex }) {
  const [query, setQuery] = useState('');
  const linked = useMemo(() => new Set(linkedIds.map(String)), [linkedIds]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scenes
      .filter((scene) => scene._id !== excludeId)
      .filter((scene) => !needle || scene.name.toLowerCase().includes(needle));
  }, [scenes, excludeId, query]);

  const available = scenes.filter((scene) => scene._id !== excludeId && !linked.has(scene._id)).length;

  return (
    <div className="scene-picker">
      {scenes.length > 7 && (
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search scenes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="scene-picker__search"
        />
      )}
      {available === 0 && (
        <p className="scene-picker__note">This scene already links to every other scene.</p>
      )}
      <div className="scene-picker__grid" role="listbox" aria-label="Destination scene">
        {candidates.map((scene) => {
          const isLinked = linked.has(scene._id);
          const isSelected = scene._id === value;
          const preview = scenePreviewUrl(scene, previewIndex);
          return (
            <button
              key={scene._id}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={isLinked}
              disabled={isLinked}
              className={`scene-picker__card ${isSelected ? 'is-selected' : ''} ${isLinked ? 'is-linked' : ''}`}
              onClick={() => onChange?.(scene._id)}
              title={isLinked ? `Already linked to ${scene.name}` : scene.name}
            >
              <span className="scene-picker__thumb">
                {preview ? <img src={preview} alt="" loading="lazy" /> : <PictureOutlined />}
                {isSelected && <CheckCircleFilled className="scene-picker__check" />}
                {isLinked && (
                  <span className="scene-picker__linked"><LinkOutlined /> Linked</span>
                )}
              </span>
              <span className="scene-picker__name">{scene.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
