/**
 * SmartNav360 — ConnectionEditor
 * Side panel for creating or editing one hotspot connection, shown beside the
 * panorama so the pin being worked on stays visible.
 *
 * - create: choose the destination by picture, with an optional reverse link
 *   so the visitor can walk back without a second round of clicking.
 * - edit:   change label, access and distance; move the pin; jump to the
 *   destination; or delete, optionally with its way back.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input, InputNumber, Popconfirm, Select, Space, Tag } from 'antd';
import {
  ArrowRightOutlined,
  CloseOutlined,
  DeleteOutlined,
  DragOutlined,
  SaveOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import ScenePicker from '../../scenes/ScenePicker';
import { ACCESS_MODES, DEFAULT_ACCESS_MODE } from '../../../constants/access';
import { scenePreviewUrl } from '../../../utils/imagePreview';
import './ConnectionEditor.css';

const autoLabel = (name) => `Go to ${name}`;

/**
 * @param {object} props
 * @param {'create'|'edit'} props.mode
 * @param {object} props.sourceScene
 * @param {object[]} props.scenes
 * @param {object} [props.hotspot] - edit mode: the connection being edited
 * @param {boolean} [props.moving] - edit mode: waiting for a new pin position
 * @param {Map<string,string>} [props.previewIndex]
 * @param {(values: object) => Promise<void>} props.onCreate
 * @param {(values: object) => Promise<void>} props.onSave
 * @param {(options: { removeWayBack: boolean }) => Promise<void>} props.onDelete
 * @param {() => Promise<void>} props.onAddWayBack
 * @param {() => void} props.onMove
 * @param {(sceneId: string) => void} props.onOpenScene
 * @param {() => void} props.onCancel
 */
export default function ConnectionEditor({
  mode,
  sourceScene,
  scenes,
  hotspot,
  moving = false,
  previewIndex,
  onCreate,
  onSave,
  onDelete,
  onAddWayBack,
  onMove,
  onOpenScene,
  onCancel,
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [removeWayBack, setRemoveWayBack] = useState(true);
  const [labelTouched, setLabelTouched] = useState(false);
  const destinationId = Form.useWatch('targetSceneId', form);

  const byId = useMemo(() => new Map(scenes.map((scene) => [scene._id, scene])), [scenes]);
  const linkedIds = (sourceScene?.hotspots || []).map((spot) => String(spot.targetScene));

  const target = byId.get(mode === 'edit' ? String(hotspot?.targetScene) : destinationId);
  const targetLinksBack = !!target?.hotspots?.some((spot) => String(spot.targetScene) === sourceScene?._id);

  // Reset whenever a different connection or scene is being worked on.
  useEffect(() => {
    setLabelTouched(false);
    setRemoveWayBack(true);
    if (mode === 'edit' && hotspot) {
      form.setFieldsValue({
        label: hotspot.label || '',
        access: hotspot.access || DEFAULT_ACCESS_MODE,
        distance: hotspot.distance ?? 0,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ access: DEFAULT_ACCESS_MODE, distance: 0, wayBack: true });
    }
  }, [mode, hotspot, sourceScene?._id, form]);

  // Name the connection after its destination until the user writes their own.
  const handleValuesChange = (changed) => {
    if ('label' in changed) setLabelTouched(true);
    if (mode === 'create' && 'targetSceneId' in changed && !labelTouched) {
      const name = byId.get(changed.targetSceneId)?.name;
      if (name) form.setFieldValue('label', autoLabel(name));
    }
  };

  const run = async (work) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // inline errors are already shown
    }
    await run(() => (mode === 'create' ? onCreate(values) : onSave(values)));
  };

  const targetPreview = target ? scenePreviewUrl(target, previewIndex) : null;

  return (
    <div className="connection-editor">
      <div className="connection-editor__header">
        <h3>
          {mode === 'create' ? 'New connection' : (
            <>Connection to <span className="connection-editor__dest">{target?.name || 'unknown scene'}</span></>
          )}
        </h3>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onCancel} aria-label="Close (Esc)" />
      </div>

      {mode === 'create' && (
        <p className="connection-editor__hint">
          The orange pin marks the spot. Click elsewhere on the panorama to move it, then choose where it leads.
        </p>
      )}

      {mode === 'edit' && moving && (
        <div className="connection-editor__moving">
          <DragOutlined /> Click the panorama where this connection should go. Press Esc to cancel.
        </div>
      )}

      {mode === 'edit' && targetPreview && (
        <button type="button" className="connection-editor__dest-card" onClick={() => onOpenScene(target._id)}>
          <img src={targetPreview} alt="" />
          <span>
            Open {target.name} <ArrowRightOutlined />
          </span>
        </button>
      )}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={handleValuesChange}
        className="connection-editor__form"
      >
        {mode === 'create' && (
          <Form.Item
            name="targetSceneId"
            label="Where does it lead?"
            rules={[{ required: true, message: 'Choose the destination scene' }]}
          >
            <ScenePicker
              scenes={scenes}
              excludeId={sourceScene?._id}
              linkedIds={linkedIds}
              previewIndex={previewIndex}
            />
          </Form.Item>
        )}

        <Form.Item name="label" label="Label shown to visitors">
          <Input placeholder={target ? autoLabel(target.name) : 'e.g. Go to Reception'} maxLength={80} />
        </Form.Item>

        <div className="connection-editor__row">
          <Form.Item name="access" label="How it is walked" tooltip="The route finder can avoid stairs and escalators for step-free routes.">
            <Select options={ACCESS_MODES} />
          </Form.Item>
          <Form.Item name="distance" label="Distance (m)">
            <InputNumber min={0} max={10000} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        {mode === 'create' && (
          <Form.Item name="wayBack" valuePropName="checked" className="connection-editor__wayback">
            <Checkbox disabled={!target || targetLinksBack}>
              {target && targetLinksBack
                ? `${target.name} already links back here`
                : `Also add a way back from ${target?.name || 'the destination'}`}
            </Checkbox>
          </Form.Item>
        )}
      </Form>

      {mode === 'edit' && target && (
        <div className="connection-editor__status">
          {targetLinksBack ? (
            <Tag icon={<SwapOutlined />} color="green">Two-way: {target.name} links back</Tag>
          ) : (
            <Space size={6} wrap>
              <Tag color="orange">One-way</Tag>
              <Button size="small" icon={<SwapOutlined />} loading={busy} onClick={() => run(onAddWayBack)}>
                Add way back
              </Button>
            </Space>
          )}
        </div>
      )}

      <div className="connection-editor__actions">
        <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={submit}>
          {mode === 'create' ? 'Create connection' : 'Save changes'}
        </Button>
        {mode === 'edit' && (
          <>
            <Button icon={<DragOutlined />} onClick={onMove} disabled={moving}>
              Move pin
            </Button>
            <Popconfirm
              title="Delete this connection?"
              description={
                targetLinksBack ? (
                  <Checkbox checked={removeWayBack} onChange={(event) => setRemoveWayBack(event.target.checked)}>
                    Also delete the way back from {target.name}
                  </Checkbox>
                ) : 'Visitors will no longer be able to walk this way.'
              }
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => run(() => onDelete({ removeWayBack: targetLinksBack && removeWayBack }))}
            >
              <Button danger icon={<DeleteOutlined />}>Delete</Button>
            </Popconfirm>
          </>
        )}
        {mode === 'create' && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
