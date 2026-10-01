// Every surface is decorative; the authoritative player stays in RoomLayout.
export default function CinemaLuxeScene({ sofaImage = null }) {
    return (
        <div className="cinema-luxe-scene" aria-hidden="true">
            <div className="luxe-back-wall" />
            <div className="luxe-ceiling"><i /><i /></div>
            <div className="luxe-wall luxe-wall-left" />
            <div className="luxe-wall luxe-wall-right" />
            <div className="luxe-floor" />
            <div className="luxe-platform" />
            <div className="luxe-screen-recess" />
            <div className="luxe-ambient" />
            <div className="luxe-aisle luxe-aisle-left"><i /><i /><i /><i /></div>
            <div className="luxe-aisle luxe-aisle-right"><i /><i /><i /><i /></div>
            {/* Optional asset slot: sofaImage="/assets/cinema-sofa.webp".
                A supplied transparent image replaces only the CSS silhouette. */}
            <div className="luxe-sofa" data-sofa-asset={Boolean(sofaImage)}>
                {sofaImage
                    ? <img className="luxe-sofa-image" src={sofaImage} alt="" />
                    : <div className="luxe-sofa-back"><span /><span /><span /></div>}
            </div>
        </div>
    );
}
