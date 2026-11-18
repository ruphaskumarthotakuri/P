export default function FormField({ label, ...inputProps }) {
  return <label>{label}<input {...inputProps} /></label>
}
