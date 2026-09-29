/**
 * "Fill black gaps" for a stitched panorama: runs the LaMa inpainting job on
 * the server and reports the new asset it saved. The original is kept.
 */
import { useState } from 'react';
import { Alert, Button, Image, Progress } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import './FillGapsButton.css';
import apiClient from '../../services/api';
import JobsService from '../../services/jobs.service';
import { API_ENDPOINTS } from '../../constants/api';
import { getImageUrl } from '../../utils/getImageUrl';

const percent = (fraction) => `${Math.round((fraction || 0) * 100)}%`;

/**
 * @param {{ assetId: string, onFilled?: (result: object) => void }} props
 */
export default function FillGapsButton({ assetId, onFilled }) {
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  const fill = async () => {
    setRunning(true);
    setFailure(null);
    setResult(null);
    try {
      const done = await JobsService.run(
        () => apiClient.post(`${API_ENDPOINTS.UPLOAD_BY_ID(assetId)}/fill`).then((response) => response.data),
        { onProgress: setJob, intervalMs: 1500 },
      );
      setResult(done);
      onFilled?.(done);
    } catch (error) {
      setFailure(error.message || 'Could not fill the gaps.');
    } finally {
      setRunning(false);
      setJob(null);
    }
  };

  return (
    <div className="fill-gaps">
      <Button icon={<ExperimentOutlined />} loading={running} onClick={fill} disabled={!assetId}>
        Fill black gaps with AI
      </Button>
      <p className="fill-gaps__hint">
        Generates floor, wall and ceiling in the black areas near what was photographed, and saves the result as a new
        asset. Takes a minute or two. &quot;Where am I?&quot; and object detection ignore the generated parts.
      </p>
      {running && (
        <div aria-live="polite">
          <Progress percent={job?.progress || 0} size="small" status="active" />
          <p className="fill-gaps__hint">{job?.detail || (job?.status === 'queued' ? 'Waiting for another fill to finish' : 'Starting')}</p>
        </div>
      )}
      {failure && <Alert type="warning" showIcon title={failure} />}
      {result && (
        <div className="fill-gaps__result">
          <Image src={getImageUrl(result.asset.path)} alt="Panorama with gaps filled" />
          <p className="fill-gaps__hint">
            Saved as &quot;{result.asset.originalName}&quot;. Filled {percent(result.filledFraction)} of the image
            {result.stillMissingFraction > 0.005
              ? `; ${percent(result.stillMissingFraction)} is too far from anything photographed and stays black. Capture more photos to cover it.`
              : '.'}
          </p>
        </div>
      )}
    </div>
  );
}
