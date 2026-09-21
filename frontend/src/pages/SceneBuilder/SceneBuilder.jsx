/**
 * SmartNav360 — Scene Builder Page
 * Create, manage, and view scenes with card-based layout.
 */
import UploadService from '../../services/upload.service';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Button, Spin } from 'antd';
import { PlusOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDebounce } from '../../hooks/useDebounce';
import { MESSAGES } from '../../constants/messages';
import SceneService from '../../services/scene.service';
import { showConfirmDialog } from '../../components/common/ConfirmDialog';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import SearchBar from '../../components/common/SearchBar';
import EmptyState from '../../components/common/EmptyState';
import SceneCard from '../../components/scenes/SceneCard';
import SceneModal from '../../components/scenes/SceneModal';
import './SceneBuilder.css';

export default function SceneBuilder() {
  useDocumentTitle('Scenes');

  const navigate = useNavigate();
  const { currentProject } = useProject();
  const { success, error } = useNotification();

  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  const loadScenes = async () => {
    setLoading(true);
    try {
      const result = await SceneService.getScenes(currentProject._id);
      if (result.success) {
        setScenes(result.data || []);
      }
    } catch (err) {
      error(MESSAGES.SCENE_LOAD_ERROR, err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAssets = async () => {
    if (!currentProject) return;
    try {
      const result = await UploadService.getUploads(currentProject._id);
      if (result.success) {
        setAssets(result.data);
      }
    } catch (err) {
      error(MESSAGES.ASSET_LOAD_ERROR, err.message);
    }
  };

  useEffect(() => {
    if (!currentProject) return;
    loadScenes();
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  const projectScenes = useMemo(() => {
    let filtered = currentProject
      ? scenes.filter(
        (s) => String(s.projectId?._id || s.projectId) === String(currentProject._id)
      )
      : scenes;

    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      filtered = filtered.filter((s) => s.name?.toLowerCase().includes(query));
    }

    return filtered;
  }, [scenes, currentProject, debouncedSearch]);

  const handleCreateScene = async (values) => {
    try {
      const result = await SceneService.createScene(values);
      if (result.success) {
        success(MESSAGES.SCENE_CREATED);
        setScenes((prev) => [result.data, ...prev]);
      }
    } catch (err) {
      error(MESSAGES.SCENE_CREATE_ERROR, err.message);
      throw err;
    }
  };

  const handleDeleteScene = (scene) => {
    showConfirmDialog({
      title: 'Delete Scene',
      content: `Are you sure you want to delete "${scene.name}"? All connections to this scene will be lost.`,
      onConfirm: async () => {
        try {
          await SceneService.deleteScene(scene._id);
          setScenes((prev) => prev.filter((s) => s._id !== scene._id));
          success(MESSAGES.SCENE_DELETED);
        } catch (err) {
          error(MESSAGES.SCENE_DELETE_ERROR, err.message);
        }
      },
    });
  };

  const handleViewScene = (scene) => {
    navigate('/experience', { state: { selectedSceneId: scene._id } });
  };

  return (
    <div className="scene-builder">
      <WorkspaceHeader
        title="Scene Builder"
        description="Create and manage scenes for your virtual navigation experience."
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            Create Scene
          </Button>
        }
      >
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search scenes..."
        />
      </WorkspaceHeader>

      <Spin spinning={loading} size="large">
        {projectScenes.length > 0 ? (
          <Row gutter={[16, 16]}>
            {projectScenes.map((scene) => (
              <Col xs={24} sm={12} md={8} lg={6} key={scene._id}>
                <SceneCard
                  scene={scene}
                  onView={handleViewScene}
                  onDelete={handleDeleteScene}
                />
              </Col>
            ))}
          </Row>
        ) : (
          !loading && (
            <EmptyState
              icon={AppstoreOutlined}
              title="No scenes yet"
              description="Create your first scene to start building the virtual navigation experience."
              actionLabel="Create Scene"
              actionIcon={<PlusOutlined />}
              onAction={() => setModalOpen(true)}
            />
          )
        )}
      </Spin>

      <SceneModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreateScene}
        projectId={currentProject?._id}
        assets={assets}
      />
    </div>
  );
}
