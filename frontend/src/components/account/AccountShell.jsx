import { Link } from 'react-router-dom';
import AccountActions from './AccountActions';
import './account.css';
export default function AccountShell({ children, className = '' }) {
    return <div className={`account-page ${className}`}><header className="account-header"><Link className="account-brand" to="/"><img src="/logo.png" alt="" />Watchly</Link><AccountActions /></header><main className="account-main">{children}</main></div>;
}
