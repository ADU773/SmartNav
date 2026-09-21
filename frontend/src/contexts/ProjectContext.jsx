/**
 * SmartNav360 — Project Context
 * Manages current project selection and project list.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import ProjectService from '../services/project.service';
import { onSessionChange } from '../services/tokenStore';

const ProjectContext = createContext(null);

const STORAGE_KEY = 'smartnav360_current_project';
const PROJECTS_STORAGE_KEY = 'smartnav360_projects';

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience; the app works without it.
  }
}

export function ProjectProvider({ children }) {
  const [currentProject, setCurrentProject] = useState(() => readStored(STORAGE_KEY, null));
  const [projects, setProjects] = useState(() => readStored(PROJECTS_STORAGE_KEY, []));
  const [loading, setLoading] = useState(false);

  // Persist current project
  useEffect(() => {
    writeStored(STORAGE_KEY, currentProject);
  }, [currentProject]);

  // Persist projects list. Writing on every change (including an empty list)
  // is what lets the cache shrink; the previous version only ever wrote a
  // non-empty list, so deleted projects survived forever in localStorage.
  useEffect(() => {
    writeStored(PROJECTS_STORAGE_KEY, projects);
  }, [projects]);

  const selectProject = useCallback((project) => {
    setCurrentProject(project);
  }, []);

  const clearProject = useCallback(() => {
    setCurrentProject(null);
  }, []);

  // Signing out must not leave the next account looking at the previous one's
  // project list.
  useEffect(() => onSessionChange((user) => {
    if (user) return;
    setProjects([]);
    setCurrentProject(null);
    writeStored(PROJECTS_STORAGE_KEY, []);
    writeStored(STORAGE_KEY, null);
  }), []);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ProjectService.getProjects();
      if (result.success) {
        const fresh = result.data || [];
        // The server is authoritative, including when it returns nothing.
        // Previously an empty response was ignored, so deleted projects
        // lingered in the sidebar and opened a broken workspace.
        setProjects(fresh);

        // Drop the selection if that project no longer exists, and refresh it
        // if its fields changed underneath us.
        setCurrentProject((current) => {
          if (!current) return current;
          const match = fresh.find((project) => project._id === current._id);
          return match || null;
        });
      }
    } catch {
      // Offline: keep whatever is cached rather than blanking the workspace.
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

  const removeProject = useCallback(async (projectId) => {
    const result = await ProjectService.deleteProject(projectId);
    if (!result.success) throw new Error(result.message);
    setProjects((prev) => prev.filter((project) => project._id !== projectId));
    setCurrentProject((current) => (current?._id === projectId ? null : current));
    return result;
  }, []);

  const value = {
    currentProject,
    projects,
    loading,
    selectProject,
    clearProject,
    fetchProjects,
    createProject,
    removeProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

/**
 * @returns {{ currentProject, projects, loading, selectProject, clearProject, fetchProjects, createProject, removeProject }}
 */
export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
