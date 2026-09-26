/**
 * SmartNav360 — AssetPicker
 * Visual image chooser: a searchable grid of thumbnails with a large preview
 * of the current choice, instead of a list of filenames.
 *
 * Works as a controlled antd form control (`value` / `onChange`), where the
 * value is the asset's stored path, e.g. "/uploads/<uuid>.jpg".
 */

import { useMemo, useState } from 'react';
import { Empty, Input, Segmented, Tag, Tooltip } from 'antd';
import { CheckCircleFilled, PictureOutlined, SearchOutlined } from '@ant-design/icons';
import { assetLabel, assetPreviewUrl, formatResolution } from '../../../utils/imagePreview';
import './AssetPicker.css';

/**
 * @param {object} props
 * @param {object[]} props.assets
 * @param {string} [props.value] - selected asset path
 * @param {(path: string|undefined) => void} [props.onChange]
 * @param {boolean} [props.preferPanoramic] - start filtered to 2:1 images when any exist
 * @param {string} [props.emptyHint] - shown when there are no assets at all
 */
export default function AssetPicker({ assets = [], value, onChange, preferPanoramic = false, emptyHint }) {
  const [query, setQuery] = useState('');
  const hasPanoramic = assets.some((asset) => asset.isPanoramic);
  const [filter, setFilter] = useState(preferPanoramic && hasPanoramic ? 'panoramic' : 'all');

  const selected = assets.find((asset) => asset.path === value) || null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (filter === 'panoramic' && !asset.isPanoramic) return false;
      return !needle || assetLabel(asset).toLowerCase().includes(needle);
    });
  }, [assets, query, filter]);

  if (assets.length === 0) {
    return (
      <Empty
        className="asset-picker__empty"
        image={<PictureOutlined />}
        description={emptyHint || 'No images uploaded yet. Add some in Assets first.'}
      />
    );
  }

  const choose = (asset) => onChange?.(asset.path === value ? undefined : asset.path);

  return (
    <div className="asset-picker">
      <div className={`asset-picker__preview ${selected ? '' : 'is-empty'}`}>
        {selected ? (
          <>
            <img src={assetPreviewUrl(selected)} alt={assetLabel(selected)} />
            <div className="asset-picker__preview-meta">
              <span className="asset-picker__preview-name">{assetLabel(selected)}</span>
              <span>
                {formatResolution(selected)}
                {selected.isPanoramic && <Tag color="green" className="asset-picker__tag">360°</Tag>}
              </span>
            </div>
          </>
        ) : (
          <span><PictureOutlined /> Choose an image below to preview it here</span>
        )}
      </div>

      <div className="asset-picker__toolbar">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search by file name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {hasPanoramic && (
          <Segmented
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { label: '360° only', value: 'panoramic' },
              { label: 'All', value: 'all' },
            ]}
          />
        )}
      </div>

      {visible.length === 0 ? (
        <p className="asset-picker__none">No images match. Clear the search or show all images.</p>
      ) : (
        <div className="asset-picker__grid" role="listbox" aria-label="Images">
          {visible.map((asset) => {
            const isSelected = asset.path === value;
            return (
              <Tooltip key={asset._id || asset.path} title={assetLabel(asset)} mouseEnterDelay={0.6}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`asset-picker__tile ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => choose(asset)}
                >
                  <img src={assetPreviewUrl(asset)} alt="" loading="lazy" />
                  {asset.isPanoramic && <span className="asset-picker__badge">360°</span>}
                  {isSelected && <CheckCircleFilled className="asset-picker__check" />}
                  <span className="asset-picker__tile-name">{assetLabel(asset)}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
