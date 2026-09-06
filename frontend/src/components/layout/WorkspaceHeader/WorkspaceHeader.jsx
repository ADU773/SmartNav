/**
 * SmartNav360 — WorkspaceHeader
 * Page-level header with title, description, and action buttons.
 * Reused by every workspace page for consistent layout.
 */

import './WorkspaceHeader.css';

export default function WorkspaceHeader({ title, description, actions, children }) {
  return (
    <div className="workspace-header">
      <div className="workspace-header__content">
        <div className="workspace-header__text">
          <h1 className="workspace-header__title">{title}</h1>
          {description && (
            <p className="workspace-header__description">{description}</p>
          )}
        </div>
        {actions && (
          <div className="workspace-header__actions">{actions}</div>
        )}
      </div>
      {children && <div className="workspace-header__extra">{children}</div>}
    </div>
  );
}
