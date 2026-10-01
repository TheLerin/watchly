// Every surface is decorative; the authoritative player stays in RoomLayout.
export default function CinemaLuxeScene() {
    return (
        <div className="cinema-luxe-scene" aria-hidden="true">
            <div className="luxe-back-wall" />
            <div className="luxe-ceiling" />
            <div className="luxe-wall luxe-wall-left" />
            <div className="luxe-wall luxe-wall-right" />
            <div className="luxe-floor" />
            <div className="luxe-screen-recess" />
            <div className="luxe-ambient" />
            <div className="luxe-aisle luxe-aisle-left"><i /><i /><i /><i /></div>
            <div className="luxe-aisle luxe-aisle-right"><i /><i /><i /><i /></div>
            <div className="luxe-sofa"><span /><span /><span /></div>
        </div>
    );
}
