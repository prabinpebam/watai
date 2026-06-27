// Skills catalog store: the Settings → Skills section reads from here. Loads the
// user's effective catalog (default + uploaded skills), with optimistic toggles
// and uploads. When the backend isn't reachable yet (not_found / signed-out) the
// list simply stays empty — there is no mock data to clean up later.
import { create } from 'zustand';
import { skillsApi } from '../../data';
import { skillValidationErrors, type SkillUpload } from '../../data/cloud/skillsApi';
import { CloudError } from '../../data/cloud/apiClient';
import { useUi } from '../../state/store';
import { fileToBase64 } from '../../lib/files';
import type { SkillSummary, SkillValidationError } from '../../lib/types';

/** Outcome of an upload/replace so the view can open the validation-errors dialog. */
export type UploadResult = { ok: true } | { ok: false; errors: SkillValidationError[] | null };

interface SkillsState {
  skills: SkillSummary[];
  loading: boolean;
  /** True only for unexpected failures (network/500) — not for "no backend yet". */
  loadError: boolean;
  /** Per-skill in-flight flag (toggle / delete). */
  busy: Record<string, boolean>;
  uploading: boolean;
  load: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  upload: (file: File) => Promise<UploadResult>;
  replace: (id: string, file: File) => Promise<UploadResult>;
  remove: (id: string) => Promise<void>;
}

const toast = (m: string, k?: 'info' | 'success' | 'error') => useUi.getState().pushToast(m, k);

function uploadFailMessage(e: unknown): string {
  if (e instanceof CloudError) {
    if (e.code === 'not_found') return "Skill upload isn't available yet.";
    if (e.code === 'conflict') return e.message || 'A skill with that name already exists.';
    if (e.code === 'unauthorized') return 'Sign in to manage skills.';
    return e.message || "Couldn't add that skill.";
  }
  return "Couldn't add that skill.";
}

export const useSkills = create<SkillsState>((set, get) => ({
  skills: [],
  loading: true,
  loadError: false,
  busy: {},
  uploading: false,

  load: async () => {
    set({ loading: true, loadError: false });
    try {
      const skills = await skillsApi.list();
      set({ skills, loading: false });
    } catch (e) {
      // "no backend yet" (not_found) or signed-out → just empty, not a scary error.
      const code = e instanceof CloudError ? e.code : 'network';
      const soft = code === 'not_found' || code === 'unauthorized';
      set({ skills: [], loading: false, loadError: !soft });
    }
  },

  setEnabled: async (id, enabled) => {
    const prev = get().skills;
    set({
      skills: prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
      busy: { ...get().busy, [id]: true },
    });
    try {
      const updated = await skillsApi.setEnabled(id, enabled);
      set({ skills: get().skills.map((s) => (s.id === id ? updated : s)) });
      toast(`${updated.name} ${enabled ? 'on' : 'off'}`);
    } catch {
      set({ skills: prev });
      toast("Couldn't update the skill", 'error');
    } finally {
      set((s) => {
        const b = { ...s.busy };
        delete b[id];
        return { busy: b };
      });
    }
  },

  upload: async (file) => {
    set({ uploading: true });
    try {
      const payload: SkillUpload = { filename: file.name, dataBase64: await fileToBase64(file) };
      const skill = await skillsApi.upload(payload);
      set((s) => ({ skills: [...s.skills.filter((x) => x.id !== skill.id), skill] }));
      toast(`Added ${skill.name}`, 'success');
      return { ok: true };
    } catch (e) {
      const errors = skillValidationErrors(e);
      if (!errors) toast(uploadFailMessage(e), 'error');
      return { ok: false, errors };
    } finally {
      set({ uploading: false });
    }
  },

  replace: async (id, file) => {
    set({ uploading: true });
    try {
      const payload: SkillUpload = { filename: file.name, dataBase64: await fileToBase64(file) };
      const skill = await skillsApi.replace(id, payload);
      set((s) => ({ skills: s.skills.map((x) => (x.id === id ? skill : x)) }));
      toast(`Updated ${skill.name}`, 'success');
      return { ok: true };
    } catch (e) {
      const errors = skillValidationErrors(e);
      if (!errors) toast(uploadFailMessage(e), 'error');
      return { ok: false, errors };
    } finally {
      set({ uploading: false });
    }
  },

  remove: async (id) => {
    const prev = get().skills;
    const skill = prev.find((s) => s.id === id);
    set({ skills: prev.filter((s) => s.id !== id), busy: { ...get().busy, [id]: true } });
    try {
      await skillsApi.remove(id);
      toast(`Removed ${skill?.name ?? 'skill'}`);
    } catch (e) {
      set({ skills: prev });
      toast(e instanceof CloudError && e.message ? e.message : "Couldn't remove the skill", 'error');
    } finally {
      set((s) => {
        const b = { ...s.busy };
        delete b[id];
        return { busy: b };
      });
    }
  },
}));
