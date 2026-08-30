import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Hash,
  Mic,
  MonitorPlay,
  Play,
  Sparkles,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useRoom } from '../context/RoomContext';
import useStageNavigation, { STAGE_TRANSITION } from '../hooks/useStageNavigation';
import useVideoAmbientLight from '../hooks/useVideoAmbientLight';
import './cinema-hero.css';

const WATCHLY_HERO_VIDEO = '/bg-video.mp4';
const PANEL_COUNT = 4;
const MotionArticle = motion.article;

// Kept as a compatibility export for the existing room shell.
export const BackgroundLayers = () => (
  <>
    <div className="bg-base-layer" />
    <div className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.08))',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.08))',
        }}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.72) 52%, rgba(0,0,0,0.96) 100%)' }} />
    </div>
    <div className="noise-overlay" />
  </>
);

const storyPanels = [
  {
    eyebrow: '01 · Watch together',
    title: 'Same scene. Same second. Miles apart.',
    copy: 'Watchly turns a video into a shared moment, keeping the room focused on what everyone came to watch.',
    icon: MonitorPlay,
    accent: 'Perfectly shared',
    metric: 'One timeline',
    points: ['Play, pause, and seek together', 'A private room code for every group', 'No account required to begin'],
  },
  {
    eyebrow: '02 · Perfect sync',
    title: 'Playback that quietly stays together.',
    copy: 'Drift correction and connection-aware states keep everyone aligned without turning movie night into troubleshooting.',
    icon: Zap,
    accent: 'Connection aware',
    metric: 'Live drift correction',
    points: ['Host-guided playback controls', 'Direct video and local playback flows', 'Visible latency and connection quality'],
  },
  {
    eyebrow: '03 · Share the moment',
    title: 'Talk, react, and laugh in the same room.',
    copy: 'Voice and live chat stay within reach without stealing attention from the screen or the people you invited.',
    icon: Mic,
    accent: 'Voice + chat',
    metric: 'Conversation, in context',
    points: ['Compact voice controls', 'Live room chat and reactions', 'Participants and roles at a glance'],
  },
  {
    eyebrow: '04 · Your room is ready',
    title: 'Drop a link. Share the code. Press play.',
    copy: 'Create a private room in seconds or join friends with the code they sent you. The cinematic tour is optional—the room is always one click away.',
    icon: Sparkles,
    accent: 'Ready in seconds',
    metric: 'Free to start',
    points: ['Create without signing up', 'Join with a private code', 'Clear host and moderator roles'],
    actions: true,
  },
];

const horizontalPanelTransition = {
  x: { duration: 0.7, ease: [0.22, 0.8, 0.22, 1] },
  y: { duration: 0 },
  opacity: { duration: 0.5, ease: 'easeOut' },
};

const verticalPanelTransition = {
  x: { duration: 0 },
  y: { duration: 0.72, ease: [0.22, 0.8, 0.22, 1] },
  opacity: { duration: 0.5, ease: 'easeOut' },
};

const getPanelEnterState = transition => {
  if (transition === STAGE_TRANSITION.HOME_TO_FIRST) {
    return { opacity: 0, x: 0, y: '110%' };
  }

  return {
    opacity: 0,
    x: transition === STAGE_TRANSITION.PANEL_BACKWARD ? '-110%' : '110%',
    y: 0,
  };
};

const getPanelCenterState = transition => ({
  opacity: 1,
  x: 0,
  y: 0,
  transition: transition === STAGE_TRANSITION.HOME_TO_FIRST
    ? verticalPanelTransition
    : horizontalPanelTransition,
});

const panelVariants = {
  exit: transition => {
    if (transition === STAGE_TRANSITION.FIRST_TO_HOME || transition === STAGE_TRANSITION.LAST_TO_HOME) {
      return {
        opacity: 0,
        x: 0,
        y: '110%',
        transition: verticalPanelTransition,
      };
    }

    return {
      opacity: 0,
      x: transition === STAGE_TRANSITION.PANEL_BACKWARD ? '110%' : '-110%',
      y: 0,
      transition: horizontalPanelTransition,
    };
  },
};

const isFocusable = element => element && !element.hasAttribute('disabled') && element.tabIndex !== -1;

const LandingNavbar = ({ onBrand, onCreate, onJoin, onNavigate, storyActive }) => (
  <header className={`landing-navbar ${storyActive ? 'is-story-active' : ''}`}>
    <button type="button" className="landing-brand" onClick={onBrand} aria-label="Watchly home">
      <img src="/logo.png" alt="" />
      <span>Watchly</span>
    </button>

    <nav className="landing-nav-links" aria-label="Landing page">
      <button type="button" onClick={() => onNavigate(1)}>Experience</button>
      <button type="button" onClick={() => onNavigate(2)}>Features</button>
      <button type="button" onClick={() => onNavigate(3)}>Voice</button>
      <button type="button" onClick={() => onNavigate(4)}>Trust</button>
    </nav>

    <div className="landing-nav-actions">
      <button type="button" className="landing-nav-join" onClick={onJoin}>Join room</button>
      <button type="button" className="landing-nav-create" onClick={onCreate}>Create room</button>
    </div>
  </header>
);

const CinemaScene = ({ onCreate, onJoin, videoRef }) => (
  <div className="cinema-stage">
    <div className="cinema-room" aria-hidden="true" />
    <div className="cinema-wall" aria-hidden="true" />
    <div className="cinema-ambient-wall" aria-hidden="true" />

    <div className="cinema-screen-shell">
      <div className="cinema-screen">
        <video
          ref={videoRef}
          className="cinema-video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          src={WATCHLY_HERO_VIDEO}
        />
        <div className="cinema-screen-vignette" aria-hidden="true" />
      </div>
    </div>

    <div className="cinema-hero-copy">
      <p className="cinema-kicker">A MOVIE NIGHT, SHARED</p>
      <h1>Same scene.<br /><span>Same second.</span></h1>
      <p>Watch together from anywhere, with playback, voice, and reactions that feel naturally in sync.</p>
      <div className="cinema-hero-actions">
        <button type="button" className="cinema-primary-action" onClick={onCreate}>
          <Play fill="currentColor" aria-hidden="true" />
          Create room
        </button>
        <button type="button" className="cinema-secondary-action" onClick={onJoin}>
          Join room
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>

    <div className="cinema-floor" aria-hidden="true"><div className="cinema-floor-reflection" /></div>
    <div className="cinema-sofa-reflection" aria-hidden="true"><img src="/assets/sofa-couple.png" alt="" /></div>
    <img
      className="cinema-sofa"
      src="/assets/sofa-couple.png"
      alt="A couple sitting together on a sofa facing the cinema screen"
      draggable="false"
    />
    <div className="cinema-sofa-contact-shadow" aria-hidden="true" />
    <div className="cinema-room-vignette" aria-hidden="true" />
  </div>
);

const StoryPanel = ({ onCreate, onJoin, panel }) => {
  const Icon = panel.icon;

  return (
    <div className="story-panel-scroll" data-story-panel-scroll>
      <div className="story-panel-copy">
        <p className="story-panel-eyebrow">{panel.eyebrow}</p>
        <h2>{panel.title}</h2>
        <p className="story-panel-description">{panel.copy}</p>
        <ul className="story-panel-points">
          {panel.points.map(point => <li key={point}><Check aria-hidden="true" />{point}</li>)}
        </ul>
        {panel.actions && (
          <div className="story-panel-actions">
            <button type="button" className="cinema-primary-action" onClick={onCreate}>Create room</button>
            <button type="button" className="cinema-secondary-action" onClick={onJoin}>Join room</button>
          </div>
        )}
      </div>

      <div className="story-panel-object" aria-hidden="true">
        <div className="story-panel-orbit story-panel-orbit-one" />
        <div className="story-panel-orbit story-panel-orbit-two" />
        <div className="story-panel-icon"><Icon /></div>
        <div className="story-panel-signal"><span />{panel.accent}</div>
        <div className="story-panel-metric"><span>{String(panel.eyebrow).slice(0, 2)}</span><strong>{panel.metric}</strong></div>
      </div>
    </div>
  );
};

const StageIndicator = ({ stage }) => (
  <div className="stage-indicator" aria-hidden="true">
    <span className="stage-indicator-line" />
    {storyPanels.map((panel, index) => <span key={panel.eyebrow} className={stage === index + 1 ? 'is-active' : ''} />)}
    <span className="stage-indicator-line" />
  </div>
);

const CinematicExperience = ({
  launcherOpen,
  onCreate,
  onJoin,
  rootRef,
}) => {
  const experienceRef = useRef(null);
  const videoRef = useRef(null);
  const {
    goToStage,
    hasInteracted,
    stage,
    stageTransition,
    unlockTransition,
  } = useStageNavigation({
    containerRef: experienceRef,
    panelCount: PANEL_COUNT,
    suspended: launcherOpen,
  });

  useVideoAmbientLight(videoRef, rootRef);

  const activePanel = stage > 0 && stage <= PANEL_COUNT ? storyPanels[stage - 1] : null;

  return (
    <section
      ref={experienceRef}
      className={`cinematic-experience ${stage > 0 ? 'has-panel' : ''}`}
      aria-label="Watchly cinematic introduction"
      aria-roledescription="interactive story"
    >
      <LandingNavbar
        storyActive={stage > 0}
        onBrand={() => goToStage(0)}
        onCreate={onCreate}
        onJoin={onJoin}
        onNavigate={goToStage}
      />
      <CinemaScene videoRef={videoRef} onCreate={onCreate} onJoin={onJoin} />
      <div className="story-panel-host">
        <AnimatePresence initial={false} custom={stageTransition} mode="sync" onExitComplete={unlockTransition}>
          {activePanel && (
            <MotionArticle
              key={stage}
              className="story-panel glass-surface"
              custom={stageTransition}
              variants={panelVariants}
              initial={getPanelEnterState(stageTransition)}
              animate={getPanelCenterState(stageTransition)}
              exit="exit"
              onAnimationComplete={unlockTransition}
            >
              <StoryPanel panel={activePanel} onCreate={onCreate} onJoin={onJoin} />
            </MotionArticle>
          )}
        </AnimatePresence>
      </div>
      {stage > 0 && <StageIndicator stage={stage} />}
      {!hasInteracted && stage === 0 && (
        <div className="cinema-scroll-hint" aria-hidden="true">
          <span className="desktop-scroll-copy">Scroll to explore</span>
          <span className="touch-scroll-copy">Swipe to explore</span>
          <ArrowDown />
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {stage === 0 ? 'Cinematic hero' : `${activePanel.eyebrow}: ${activePanel.title}`}
      </p>
    </section>
  );
};

const RoomLauncher = ({
  activeTab,
  canSubmit,
  handleCreate,
  handleJoin,
  handleKey,
  joinCode,
  nickname,
  onClose,
  open,
  setActiveTab,
  setJoinCode,
  setNickname,
}) => {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleDialogKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button, input, [href], select, textarea, [tabindex]')].filter(isFocusable);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleDialogKey);
    return () => {
      window.removeEventListener('keydown', handleDialogKey);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="room-launcher-backdrop" role="presentation" onMouseDown={onClose} data-stage-nav-ignore>
      <section
        ref={dialogRef}
        className="room-launcher glass-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-launcher-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <button type="button" className="room-launcher-close" onClick={onClose} aria-label="Close room launcher"><X aria-hidden="true" /></button>
        <p className="room-launcher-kicker">WATCH TOGETHER</p>
        <h2 id="room-launcher-title">Start your Watchly room.</h2>
        <p className="room-launcher-copy">Create a private room or enter a code from a friend. No account required.</p>
        <div className="room-launcher-tabs" role="tablist" aria-label="Room action">
          <button type="button" role="tab" aria-selected={activeTab === 'create'} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => setActiveTab('create')}>Create room</button>
          <button type="button" role="tab" aria-selected={activeTab === 'join'} className={activeTab === 'join' ? 'is-active' : ''} onClick={() => setActiveTab('join')}>Join room</button>
        </div>
        <label className="room-launcher-field">
          <span>Nickname</span>
          <span className="room-launcher-input-wrap">
            <User aria-hidden="true" />
            <input autoFocus type="text" value={nickname} maxLength={24} placeholder="Your nickname" onChange={event => setNickname(event.target.value)} onKeyDown={handleKey} />
          </span>
        </label>
        {activeTab === 'join' && (
          <label className="room-launcher-field">
            <span>Room code</span>
            <span className="room-launcher-input-wrap">
              <Hash aria-hidden="true" />
              <input type="text" value={joinCode} maxLength={10} placeholder="ROOM CODE" onChange={event => setJoinCode(event.target.value.toUpperCase())} onKeyDown={handleKey} />
            </span>
          </label>
        )}
        <button type="button" className="room-launcher-submit" onClick={activeTab === 'create' ? handleCreate : handleJoin} disabled={!canSubmit}>
          {activeTab === 'create' ? <Play fill="currentColor" aria-hidden="true" /> : <Users aria-hidden="true" />}
          {activeTab === 'create' ? 'Create room' : 'Join room'}
          <ArrowRight aria-hidden="true" />
        </button>
      </section>
    </div>
  );
};

const LandingPage = () => {
  const navigate = useNavigate();
  const { createRoom, joinRoom, currentUser, roomId } = useRoom();
  const rootRef = useRef(null);
  const [nickname, setNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [activeTab, setActiveTab] = useState('create');
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    if (currentUser && roomId) navigate(`/room/${roomId}`);
  }, [currentUser, navigate, roomId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  const handleCreate = async () => {
    if (!nickname.trim()) return;
    try { await createRoom(nickname.trim()); } catch (error) { toast.error(error.message); }
  };

  const handleJoin = async () => {
    if (!nickname.trim() || !joinCode.trim()) return;
    try { await joinRoom(joinCode.trim().toUpperCase(), nickname.trim()); } catch (error) { toast.error(error.message); }
  };

  const handleKey = event => {
    if (event.key !== 'Enter') return;
    if (activeTab === 'create') handleCreate(); else handleJoin();
  };

  const openLauncher = useCallback(tab => { setActiveTab(tab); setLauncherOpen(true); }, []);
  const closeLauncher = useCallback(() => setLauncherOpen(false), []);

  const canSubmit = Boolean(nickname.trim() && (activeTab === 'create' || joinCode.trim()));

  return (
    <div ref={rootRef} className="watchly-landing">
      <CinematicExperience
        rootRef={rootRef}
        launcherOpen={launcherOpen}
        onCreate={() => openLauncher('create')}
        onJoin={() => openLauncher('join')}
      />
      <RoomLauncher
        activeTab={activeTab}
        canSubmit={canSubmit}
        handleCreate={handleCreate}
        handleJoin={handleJoin}
        handleKey={handleKey}
        joinCode={joinCode}
        nickname={nickname}
        onClose={closeLauncher}
        open={launcherOpen}
        setActiveTab={setActiveTab}
        setJoinCode={setJoinCode}
        setNickname={setNickname}
      />
    </div>
  );
};

export default LandingPage;
