import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ProjectProvider, useProject } from '../ProjectContext';
import ProjectService from '../../services/project.service';

const PROJECTS_KEY = 'smartnav360_projects';
const CURRENT_KEY = 'smartnav360_current_project';

const wrapper = ({ children }) => <ProjectProvider>{children}</ProjectProvider>;

describe('ProjectContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('drops projects the server no longer returns', async () => {
    // A stale cache from an earlier session, including a deleted project.
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([
      { _id: 'alive', name: 'Alive' },
      { _id: 'deleted', name: 'Deleted' },
    ]));
    vi.spyOn(ProjectService, 'getProjects').mockResolvedValue({
      success: true,
      data: [{ _id: 'alive', name: 'Alive' }],
    });

    const { result } = renderHook(() => useProject(), { wrapper });
    await act(() => result.current.fetchProjects());

    expect(result.current.projects.map((project) => project._id)).toEqual(['alive']);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(PROJECTS_KEY))).toHaveLength(1);
    });
  });

  it('clears a selected project that no longer exists instead of opening a broken workspace', async () => {
    localStorage.setItem(CURRENT_KEY, JSON.stringify({ _id: 'deleted', name: 'Deleted' }));
    vi.spyOn(ProjectService, 'getProjects').mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useProject(), { wrapper });
    expect(result.current.currentProject?._id).toBe('deleted');

    await act(() => result.current.fetchProjects());

    expect(result.current.currentProject).toBeNull();
    expect(result.current.projects).toEqual([]);
  });

  it('writes an empty list so the cache can shrink to nothing', async () => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([{ _id: 'gone', name: 'Gone' }]));
    vi.spyOn(ProjectService, 'getProjects').mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useProject(), { wrapper });
    await act(() => result.current.fetchProjects());

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(PROJECTS_KEY))).toEqual([]);
    });
  });

  it('keeps the cached list when the request fails, so offline still works', async () => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([{ _id: 'cached', name: 'Cached' }]));
    vi.spyOn(ProjectService, 'getProjects').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useProject(), { wrapper });
    await act(() => result.current.fetchProjects());

    expect(result.current.projects.map((project) => project._id)).toEqual(['cached']);
  });

  it('removes a deleted project from the list and the selection', async () => {
    vi.spyOn(ProjectService, 'getProjects').mockResolvedValue({
      success: true,
      data: [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B' }],
    });
    vi.spyOn(ProjectService, 'deleteProject').mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProject(), { wrapper });
    await act(() => result.current.fetchProjects());
    act(() => result.current.selectProject({ _id: 'a', name: 'A' }));

    await act(() => result.current.removeProject('a'));

    expect(result.current.projects.map((project) => project._id)).toEqual(['b']);
    expect(result.current.currentProject).toBeNull();
  });
});
