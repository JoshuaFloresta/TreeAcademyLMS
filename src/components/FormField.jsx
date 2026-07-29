export default function FormField({ label, error, children }) {
  return <label className="form-field"><span>{label}</span>{children}{error && <small>{error}</small>}</label>
}
