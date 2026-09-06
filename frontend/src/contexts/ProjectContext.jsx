/**
 * SmartNav360 — Project Context
 * Manages current project selection and project list.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import ProjectService from '../services/project.service';

const ProjectContext = createContext(null);

const STORAGE_KEY = 'smartnav360_current_project';
const PROJECTS_STORAGE_KEY = 'smartnav360_projects';

export function ProjectProvider({ children }) {
  const [currentProject, setCurrentProject] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [projects, setProjects] = useState(() => {
    try {
      const stored = localStorage.getItem(PROJECTS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [loading, setLoading] = useState(false);

  // Persist current project
  useEffect(() => {
    if (currentProject) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentProject));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [currentProject]);

  // Persist projects list
  useEffect(() => {
    if (projects.length > 0) {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    }
  }, [projects]);

  const selectProject = useCallback((project) => {
    setCurrentProject(project);
  }, []);

  const clearProject = useCallback(() => {
    setCurrentProject(null);
  }, []);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ProjectService.getProjects();
      if (result.success && result.data?.length > 0) {
        setProjects(result.data);
      }
    } catch {
      // Silently use locally cached projects
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (data) => {
    const result = await ProjectService.createProject(data);
    if (result.success) {
      const newProject = result.data;
      setProjects((prev) => [newProject, ...prev]);
      return newProject;
    }
    throw new Error(result.message);
  }, []);

  const value = {
    currentProject,
    projects,
    loading,
    selectProject,
    clearProject,
    fetchProjects,
    createProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

/**
 * @returns {{ currentProject, projects, loading, selectProject, clearProject, fetchProjects, createProject }}
 */
export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
