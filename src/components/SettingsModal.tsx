import { useEffect, useState } from 'react';
import { FolderOpen, KeyRound } from 'lucide-react';
import Modal from './Modal';
import { useEditor } from '../store/editor';

export default function SettingsModal({ onClose }: { onClose(): void }) {
  const projectSettings = useEditor((state) => state.project.settings);
  const updateSettings = useEditor((state) => state.updateSettings);
  const [apiKey, setApiKey] = useState('');
  const [jevApiKey, setJevApiKey] = useState('');
  const [reasoning, setReasoning] = useState<'medium' | 'high'>('medium');
  const [blenderPath, setBlenderPath] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [hasJevKey, setHasJevKey] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { window.abaco?.getSettings().then((settings) => { setHasKey(settings.hasApiKey); setHasJevKey(settings.hasJevApiKey); setReasoning(settings.reasoning); setBlenderPath(settings.blenderPath); }); }, []);
  const browse = async () => { const path = await window.abaco?.chooseBlender(); if (path) setBlenderPath(path); };
  const save = async () => {
    if (!window.abaco) return setStatus('Open this screen in the Electron desktop app.');
    await window.abaco.saveSettings({ apiKey: apiKey || undefined, jevApiKey: jevApiKey || undefined, reasoning, blenderPath: blenderPath || undefined });
    setStatus('Settings saved.'); setHasKey(Boolean(apiKey) || hasKey); setHasJevKey(Boolean(jevApiKey) || hasJevKey); setApiKey(''); setJevApiKey('');
  };
  return <Modal title="Settings" onClose={onClose}>
    <div className="settings-form">
      <label className="field"><span>OpenAI API key</span><div className="input-with-icon"><KeyRound size={16} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? 'Key configured · enter a new one to replace it' : 'sk-…'} /></div><small>Encrypted by the system and never stored in the project.</small></label>
      <label className="field"><span>TypeSafe API key · Jev</span><div className="input-with-icon"><KeyRound size={16} /><input type="password" value={jevApiKey} onChange={(event) => setJevApiKey(event.target.value)} placeholder={hasJevKey ? 'Key configured · enter a new one to replace it' : 'TypeSafe key'} /></div><small>Used only by Jev. Laya runs locally and needs no key; it downloads the model on first use. The Jev key is encrypted and never stored in the project.</small></label>
      <label className="field"><span>Astra reasoning</span><select value={reasoning} onChange={(event) => setReasoning(event.target.value as 'medium' | 'high')}><option value="medium">Medium · recommended</option><option value="high">High · more complex scenes</option></select></label>
      <label className="field"><span>Blender executable</span><div className="path-picker"><input value={blenderPath} onChange={(event) => setBlenderPath(event.target.value)} placeholder="Detected automatically" /><button className="icon" onClick={browse}><FolderOpen size={16} /></button></div><small>On Mac, Blender is searched for in Applications, Desktop, and the user Applications folder.</small></label>
      <details className="advanced-panel settings-advanced"><summary>Advanced project settings</summary><div className="settings-grid">
        <label className="field"><span>Frames per second</span><input type="number" min="1" max="120" value={projectSettings.fps} onChange={(event) => updateSettings({ fps: Number(event.target.value) })} /></label>
        <label className="field"><span>Duration (frames)</span><input type="number" min="1" value={projectSettings.frameEnd} onChange={(event) => updateSettings({ frameEnd: Number(event.target.value) })} /></label>
        <label className="field"><span>Width</span><input type="number" min="1" value={projectSettings.resolutionX} onChange={(event) => updateSettings({ resolutionX: Number(event.target.value) })} /></label>
        <label className="field"><span>Height</span><input type="number" min="1" value={projectSettings.resolutionY} onChange={(event) => updateSettings({ resolutionY: Number(event.target.value) })} /></label>
      </div></details>
      {status && <p className="settings-status">{status}</p>}
    </div>
    <footer className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button className="primary" onClick={save}>Save settings</button></footer>
  </Modal>;
}
