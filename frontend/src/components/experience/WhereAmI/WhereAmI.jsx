/**
 * SmartNav360 — WhereAmI
 * Take a photo of your surroundings; the server matches it against every
 * scene's panorama and says which scene you are in and which way you face.
 * "Start here" jumps there with the camera turned to match the photo, which
 * also makes it the starting point for the route finder.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin, Tag } from 'antd';
import { AimOutlined, CameraOutlined, CompassOutlined } from '@ant-design/icons';
import LocateService from '../../../services/locate.service';
import { getImageUrl } from '../../../utils/getImageUrl';
import './WhereAmI.css';

const CONFIDENCE = {
  high: { color: 'green', label: 'Confident match' },
  medium: { color: 'gold', label: 'Likely match' },
  low: { color: 'default', label: 'Not sure' },
};

/** Plain-language direction, relative to the scene's starting view. */
function describeHeading(yawDeg) {
  const yaw = Math.round(yawDeg);
  if (Math.abs(yaw) <= 15) return 'facing the starting view';
  if (Math.abs(yaw) >= 165) return 'facing away from the starting view';
  return `turned ${Math.abs(yaw)}° ${yaw > 0 ? 'right' : 'left'} of the starting view`;
}

/**
 * @param {object} props
 * @param {string} [props.projectId] - owner mode
 * @param {string} [props.shareToken] - anonymous visitors of a published tour
 * @param {(sceneId: string, yawDeg: number) => void} props.onStartHere
 */
export default function WhereAmI({ projectId, shareToken, onStartHere }) {
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoUrl(URL.createObjectURL(file));
    setResult(null);
    setFailure(null);
    setOpen(true);
    setLoading(true);
    try {
      const response = await LocateService.locate(file, { projectId, shareToken });
      setResult(response.data);
    } catch (err) {
      setFailure(err.message || 'Could not work out where this photo was taken.');
    } finally {
      setLoading(false);
    }
  };

  const start = (match) => {
    onStartHere(match.sceneId, match.yawDeg);
    setOpen(false);
  };

  const [best, ...others] = result?.matches || [];

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="where-am-i__input"
        onChange={handleFile}
      />
      <Button
        type="primary"
        block
        icon={<CompassOutlined />}
        onClick={() => inputRef.current?.click()}
        disabled={!projectId && !shareToken}
      >
        Where am I?
      </Button>

      <Modal
        open={open}
        title={<span><CompassOutlined /> Where am I?</span>}
        onCancel={() => setOpen(false)}
        footer={null}
        width={560}
        destroyOnHidden
      >
        <div className="where-am-i">
          {photoUrl && <img className="where-am-i__photo" src={photoUrl} alt="Your photo" />}

          {loading && (
            <div className="where-am-i__loading">
              <Spin />
              <span>Comparing your photo with every scene… The first search in a tour also prepares its index, which can take a few seconds per scene.</span>
            </div>
          )}

          {failure && <Alert type="error" showIcon title="Could not locate this photo" description={failure} />}

          {best && (
            <>
              {best.confidence === 'low' && (
                <Alert
                  type="warning"
                  showIcon
                  title="This photo does not clearly match any mapped scene"
                  description="You may be somewhere that was not captured. Try again with more of the room in view — walls, doors and windows work better than a close-up."
                />
              )}
              <div className={`where-am-i__best confidence-${best.confidence}`}>
                {best.image && <img src={getImageUrl(best.image)} alt="" />}
                <div className="where-am-i__best-body">
                  <Tag color={CONFIDENCE[best.confidence].color}>{CONFIDENCE[best.confidence].label}</Tag>
                  <h3>{best.name}</h3>
                  <p>You appear to be {describeHeading(best.yawDeg)}.</p>
                  <Button type="primary" icon={<AimOutlined />} onClick={() => start(best)}>
                    Start here
                  </Button>
                </div>
              </div>

              {others.length > 0 && (
                <div className="where-am-i__others">
                  <span>Not right? Other possibilities:</span>
                  {others.map((match) => (
                    <Button key={match.sceneId} size="small" onClick={() => start(match)}>
                      {match.name}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}

          {!loading && (
            <Button icon={<CameraOutlined />} onClick={() => inputRef.current?.click()}>
              Try another photo
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
