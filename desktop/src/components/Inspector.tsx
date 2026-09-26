import { memo } from 'react'
import { PanelRightClose } from 'lucide-react'
import type { BrowserAnnotationsApi } from '@/hooks/useBrowserAnnotations'
import type { StampedPointerEvent } from '@/hooks/useAgentBrowserTabs'
import type { AgentBrowserTabRecord, AutomationScheduleRecord, EnterpriseDevelopmentOverview, GitStatus, InspectorTab, NativeHeartbeatRecord, PrimeWorkApi, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import type { AgentSlotRect } from './AgentBrowserLayer'
import { BrowserPanel } from './inspector/BrowserPanel'
import { ChangesPanel } from './inspector/ChangesPanel'
import { FilesPanel } from './inspector/FilesPanel'
import { SummaryPanel } from './inspector/SummaryPanel'
import { TeamDevelopmentInspector } from './inspector/TeamDevelopmentInspector'
import { IconButton, useFocusTrap } from './ui'

export interface InspectorProps {
  platform?: NodeJS.Platform
  activeTab: InspectorTab
  onTabChange(tab: InspectorTab): void
  onClose(): void
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  cwd?: string
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
  automations: AutomationScheduleRecord[]
  heartbeats: NativeHeartbeatRecord[]
  onOpenAutomation(id: string): void
  browserHome: string
  browserNavigationRequest?: { id: number; url: string }
  onBrowserNavigationRequestHandled?(id: number): void
  browserAnnotations: BrowserAnnotationsApi
  agentBrowserTabs: AgentBrowserTabRecord[]
  activeAgentTabId: string | null
  agentPreviewSelected: boolean
  onSelectAgentTab(tabId: string): void
  onCloseAgentTab(tabId: string): void
  onShowBrowserPreview(): void
  onAgentSlotRect(rect: AgentSlotRect | null): void
  agentSessionKey?: string
  onPreviewContext(webContentsId: number | null, sessionFile: string | null): void
  previewPointerEvent: StampedPointerEvent | null
  onNavigateAgentTab(tabId: string, action: 'back' | 'forward' | 'reload'): void
  onRefreshGit(): Promise<void> | void
  onOpenExternal(url: string): void
  onRevealPath(path: string): void
  onGrantProject(): Promise<void> | void
  teamDevelopment?: { enterprise: PrimeWorkApi['enterprise']; agent: PrimeWorkApi['agent']; accountId: string; overview?: EnterpriseDevelopmentOverview; loading: boolean; onRefresh(): void }
  overlay?: boolean
}

const tabs: Array<{ id: InspectorTab; label: string }> = [{ id: 'summary', label: 'Summary' }, { id: 'changes', label: 'Changes' }, { id: 'browser', label: 'Browser' }, { id: 'files', label: 'Files' }]

/** Memoized so streaming transcript updates (which this component no longer consumes outside the Summary tab) do not re-render the inspector shell. */
export const Inspector = memo(function Inspector({ activeTab, onTabChange, onClose, agentName, shortName, project, cwd, runtime, messages, git, automations, heartbeats, onOpenAutomation, browserHome, browserNavigationRequest, onBrowserNavigationRequestHandled, browserAnnotations, agentBrowserTabs, activeAgentTabId, agentPreviewSelected, onSelectAgentTab, onCloseAgentTab, onShowBrowserPreview, onAgentSlotRect, agentSessionKey, onPreviewContext, previewPointerEvent, onNavigateAgentTab, onRefreshGit, onOpenExternal, onRevealPath, onGrantProject, teamDevelopment, overlay = false, platform = 'darwin' }: InspectorProps) {
  const inspectorRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const visibleTabs = teamDevelopment ? [tabs[0]!, { id: 'team-division' as const, label: '团队分工' }, { id: 'team-workflow' as const, label: '工作流' }, ...tabs.slice(1)] : tabs
  const selectedTab = activeTab === 'development' ? 'team-division' : activeTab
  const teamTab = selectedTab === 'team-workflow' ? 'team-workflow' : 'team-division'
  const moveTab = (current: number, key: string) => {
    let next = current
    if (key === 'ArrowRight') next = (current + 1) % visibleTabs.length
    else if (key === 'ArrowLeft') next = (current - 1 + visibleTabs.length) % visibleTabs.length
    else if (key === 'Home') next = 0
    else if (key === 'End') next = visibleTabs.length - 1
    else return
    const tab = visibleTabs[next]!
    onTabChange(tab.id)
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${tab.id}`)?.focus())
  }
  return <aside ref={inspectorRef} className="inspector" aria-label="Session inspector" tabIndex={overlay ? -1 : undefined}>
    <div className="inspector__tabs">
      <div className="inspector__tab-track" role="tablist" aria-label="Inspector views">
        {visibleTabs.map((tab, index) => <button id={`inspector-tab-${tab.id}`} type="button" role="tab" aria-selected={selectedTab === tab.id} aria-controls={`inspector-panel-${tab.id}`} tabIndex={selectedTab === tab.id ? 0 : -1} className={selectedTab === tab.id ? 'is-active' : ''} key={tab.id} onKeyDown={(event) => { if (['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) { event.preventDefault(); moveTab(index, event.key) } }} onClick={() => onTabChange(tab.id)}>{tab.label}{tab.id === 'changes' && git.files.length ? <span>{git.files.length}</span> : null}</button>)}
      </div>
      <IconButton label="Close inspector" onClick={onClose}><PanelRightClose size={15}/></IconButton>
    </div>
    {selectedTab !== 'team-division' && selectedTab !== 'team-workflow' && <div id={`inspector-panel-${selectedTab}`} className="inspector__body" role="tabpanel" aria-labelledby={`inspector-tab-${selectedTab}`} tabIndex={0}>
      {selectedTab === 'summary' ? <SummaryPanel agentName={agentName} shortName={shortName} project={project} runtime={runtime} messages={messages} git={git} automations={automations} heartbeats={heartbeats} onOpenAutomation={onOpenAutomation}/> : null}
      {selectedTab === 'changes' ? <ChangesPanel key={cwd ?? 'no-workspace'} cwd={cwd} git={git} readOnly={project?.readOnly === true} onGrantProject={onGrantProject} onRefreshGit={onRefreshGit}/> : null}
      {selectedTab === 'browser' ? <BrowserPanel platform={platform} home={browserHome} navigationRequest={browserNavigationRequest} onNavigationRequestHandled={onBrowserNavigationRequestHandled} onOpenExternal={onOpenExternal} annotations={browserAnnotations} agentTabs={agentBrowserTabs} activeAgentTabId={activeAgentTabId} previewSelected={agentPreviewSelected} onSelectAgentTab={onSelectAgentTab} onCloseAgentTab={onCloseAgentTab} onShowPreview={onShowBrowserPreview} onAgentSlotRect={onAgentSlotRect} agentSessionKey={agentSessionKey} onPreviewContext={onPreviewContext} previewPointerEvent={previewPointerEvent} onNavigateAgentTab={onNavigateAgentTab}/> : null}
      {selectedTab === 'files' ? <FilesPanel project={project} git={git} onReveal={onRevealPath}/> : null}
    </div>}
    {teamDevelopment && (selectedTab === 'team-division' || selectedTab === 'team-workflow') && <div id={`inspector-panel-${teamTab}`} className="inspector__body" role="tabpanel" aria-labelledby={`inspector-tab-${teamTab}`} tabIndex={0}><TeamDevelopmentInspector key={agentSessionKey ?? runtime?.runtimeId ?? 'new-session'} {...teamDevelopment} runtime={runtime} sessionFile={agentSessionKey} view={selectedTab === 'team-workflow' ? 'workflow' : 'division'}/></div>}
  </aside>
})
