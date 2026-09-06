/**
 * SmartNav360 — Project Selection Page
 * Application entry point. Inspired by Firebase Console.
 * Users select or create a project before entering the workspace.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Button, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useDebounce } from '../../hooks/useDebounce';
import { MESSAGES } from '../../constants/messages';
import ProjectCard from '../../components/project/ProjectCard';
import ProjectModal from '../../components/project/ProjectModal';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import './ProjectSelection.css';

export default function ProjectSelection() {
  useDocumentTitle('Projects');

  const navigate = useNavigate();
  const { projects, loading, fetchProjects, createProject, selectProject } = useProject();
  const { success, error } = useNotification();

  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filteredProjects = useMemo(() => {
    if (!debouncedSearch) return projects;
    const query = debouncedSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.name?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
    );
  }, [projects, debouncedSearch]);

  const handleCreateProject = async (values) => {
    try {
      const newProject = await createProject(values);
      success(MESSAGES.PROJECT_CREATED);
      selectProject(newProject);
      navigate('/dashboard');
    } catch (err) {
      error(MESSAGES.PROJECT_CREATE_ERROR, err.message);
    }
  };

  const handleSelectProject = (project) => {
    selectProject(project);
    navigate('/dashboard');
  };

  if (loading && projects.length === 0) {
    return <LoadingSpinner message="Loading projects..." fullPage />;
  }

  return (
    <div className="project-selection">
      {/* Header */}
      <header className="project-selection__header">
        <div className="project-selection__brand">
          <div className="project-selection__logo">
            <span>◇</span>
          </div>
          <div>
            <h1 className="project-selection__title">SmartNav360</h1>
            <p className="project-selection__subtitle">
              AI-Assisted Configurable 360° Virtual Navigation Framework
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="project-selection__content">
        <div className="project-selection__toolbar">
          <div>
            <h2 className="project-selection__section-title">Your Projects</h2>
            <p className="project-selection__section-desc">
              Select a project to open its workspace, or create a new one.
            </p>
          </div>
          <div className="project-selection__actions">
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              className="project-selection__search"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModalOpen(true)}
            >
              Create Project
            </Button>
          </div>
        </div>

        {filteredProjects.length > 0 ? (
          <Row gutter={[20, 20]}>
            {filteredProjects.map((project) => (
              <Col xs={24} sm={12} md={8} lg={6} key={project._id || project.name}>
                <ProjectCard project={project} onClick={handleSelectProject} />
              </Col>
            ))}
          </Row>
        ) : (
          <EmptyState
            title="No projects yet"
            description="Create your first project to start building an immersive virtual navigation experience."
            actionLabel="Create Project"
            actionIcon={<PlusOutlined />}
            onAction={() => setModalOpen(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="project-selection__footer">
        <span>SmartNav360 v0.1.0 · AI-Assisted Virtual Navigation</span>
      </footer>

      {/* Modal */}
      <ProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreateProject}
      />
    </div>
  );
}
