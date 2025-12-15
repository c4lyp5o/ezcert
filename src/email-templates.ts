export const activationEmailTemplate = (activationLink: string) => {
	return `
    <h1 style="font-family: Arial, sans-serif; color: #111827; margin-bottom: 0.5em;">
      🎉 Application Approved
    </h1>

    <p style="font-family: Arial, sans-serif; color: #374151; font-size: 15px; line-height: 1.6;">
      Good news! Your <strong>EzCert</strong> account has been reviewed and approved by our administrator.
    </p>

    <p style="font-family: Arial, sans-serif; color: #374151; font-size: 15px; line-height: 1.6;">
      To complete your setup and begin managing attendance and certificates, please activate your account using the button below:
    </p>

    <p style="margin: 24px 0;">
      <a
        href="${activationLink}"
        style="
          display: inline-block;
          background-color: #111827;
          color: #ffffff;
          text-decoration: none;
          padding: 12px 20px;
          border-radius: 6px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          font-weight: 600;
        "
      >
        Activate Your Account
      </a>
    </p>

    <p style="font-family: Arial, sans-serif; color: #6b7280; font-size: 13px; line-height: 1.6;">
      This activation link is unique to you and will expire for security reasons.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />

    <p style="font-family: Arial, sans-serif; color: #6b7280; font-size: 12px; line-height: 1.6;">
      If you did not apply for an EzCert account, you may safely ignore this email.
    </p>

    <p style="font-family: Arial, sans-serif; color: #6b7280; font-size: 12px;">
      — The EzCert Team
    </p>
  `;
};
