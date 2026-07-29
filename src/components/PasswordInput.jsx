import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// forwardRef so react-hook-form's uncontrolled `register()` ref can attach directly to the
// underlying <input> — without it, RHF can't read the DOM value and submission breaks.
const PasswordInput = forwardRef(function PasswordInput({ className = '', ...inputProps }, ref) {
  const [visible, setVisible] = useState(false)
  return <span className={`password-input ${className}`}>
    <input {...inputProps} ref={ref} type={visible ? 'text' : 'password'} />
    <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'} tabIndex={-1}>
      {visible ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  </span>
})

export default PasswordInput
