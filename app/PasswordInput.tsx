"use client";

import { useState } from "react";
import { Eye, EyeOff } from "./icons";

// A password field with a show/hide toggle.
//
// One component rather than a toggle bolted onto each form, because the interesting
// part is what it does NOT do: it never keeps the password visible across a remount,
// it stays out of the tab order so keyboard users are not stopped on their way to the
// submit button, and the button is type="button" so it can never submit the form it
// sits inside. Getting any of those wrong on one form out of eight is exactly what a
// shared component prevents.

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Label text. Omit to render the input alone, for forms that label it themselves. */
  label?: string;
};

export function PasswordInput({ label, id, className, ...rest }: Props) {
  const [shown, setShown] = useState(false);

  const field = (
    <div className="pwfield">
      <input {...rest} id={id} type={shown ? "text" : "password"} className={className} />
      <button
        type="button"
        className="pwtoggle"
        onClick={() => setShown((s) => !s)}
        tabIndex={-1}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
      >
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );

  if (!label) return field;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {field}
    </div>
  );
}
