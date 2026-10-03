import { safeAvatar } from '../../utils/account';
export default function Avatar({ name, url, size = 36 }) {
    const source = safeAvatar(url);
    return <span className="account-avatar" style={{ width: size, height: size }}>
        <span aria-hidden="true">{String(name || '?').trim().slice(0, 1).toUpperCase()}</span>
        {source && <img src={source} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />}
    </span>;
}
