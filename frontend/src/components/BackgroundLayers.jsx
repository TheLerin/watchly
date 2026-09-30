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
