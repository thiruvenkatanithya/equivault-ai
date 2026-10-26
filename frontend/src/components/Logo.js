import React from 'react';

const Logo = ({ className = '' }) => (
  <span className={`logo ${className}`.trim()} aria-hidden="true">
    <span className="logo-ring logo-ring-outer" />
    <span className="logo-ring logo-ring-inner" />
    <svg viewBox="0 0 100 100" className="logo-symbol" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M30 40L50 70L70 40"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M50 30V70" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path
        d="M40 30L50 20L60 30"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export default Logo;
