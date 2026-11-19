export default function Brand({ full = false }) {
  if (full) return <img className="brand-full-logo" src="/minstryconnect-logo.svg" alt="MinstryConnect — Connecting Pastors, Churches & Ministries" />
  return <span className="ministry-brand"><img src="/minstryconnect-icon.svg" alt="" aria-hidden="true" /><span>Minstry<span className="brand-connect">Connect</span></span></span>
}
