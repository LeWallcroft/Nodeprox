export interface TransactionalEmailPort {
  sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export class BrevoTransactionalEmail implements TransactionalEmailPort {
  constructor(
    private readonly config: {
      apiKey: string;
      fromEmail: string;
      fromName: string;
    },
  ) {}

  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: this.config.fromEmail, name: this.config.fromName },
        to: [{ email: input.to }],
        subject: "Restablece tu contraseña · NodeProx",
        htmlContent: passwordResetTemplate(input),
        textContent: passwordResetText(input),
      }),
    });
    if (!response.ok) throw new Error("Brevo password reset delivery failed");
  }
}

export class NoopTransactionalEmail implements TransactionalEmailPort {
  async sendPasswordReset(): Promise<void> {}
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function passwordResetTemplate(input: { resetUrl: string; expiresAt: Date }) {
  const resetUrl = escapeHtml(input.resetUrl);
  const expiresAt = escapeHtml(
    new Intl.DateTimeFormat("es-PE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(input.expiresAt),
  );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Restablece tu contraseña · NodeProx</title>
  </head>
  <body style="margin:0;background:#f3f5ff;color:#17213d;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5ff;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 28px rgba(39,42,112,.14);">
          <tr>
            <td style="padding:30px 34px;background:linear-gradient(135deg,#11152e 0%,#151a3c 55%,#4d38c8 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size:25px;font-weight:700;letter-spacing:-1px;white-space:nowrap;">
                    <span style="color:#7455ff;">✦</span> Node<span style="font-weight:400;">Prox</span>
                    <div style="margin-top:4px;font-size:9px;letter-spacing:1.5px;color:#a9b5e9;font-weight:400;">INFRAESTRUCTURA SIN LÍMITES</div>
                  </td>
                  <td align="right" style="font-size:9px;line-height:16px;letter-spacing:1.2px;color:#b7c0ed;text-transform:uppercase;">
                    Administra · Despliega · Escala<br>tu infraestructura, más simple
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 42px 30px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#5d45d8;text-transform:uppercase;">Seguridad de cuenta</div>
              <h1 style="margin:18px 0 18px;font-size:34px;line-height:1.1;letter-spacing:-.8px;color:#17213d;">Restablece tu contraseña</h1>
              <p style="margin:0 0 16px;font-size:17px;line-height:1.45;color:#263454;">Hola,</p>
              <p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#263454;">Recibimos una solicitud para restablecer la contraseña de tu cuenta de NodeProx.</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#263454;">Haz clic en el botón de abajo para continuar con el proceso.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                <tr><td style="border-radius:14px;background:#5b3ee5;box-shadow:0 8px 18px rgba(91,62,229,.24);">
                  <a href="${resetUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">&nbsp; Restablecer contraseña&nbsp; →</a>
                </td></tr>
              </table>
              <p style="margin:20px 0 26px;text-align:center;font-size:13px;color:#607092;">◷&nbsp; Este enlace expira el ${expiresAt}.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f3ff;border-radius:10px;">
                <tr><td style="padding:16px 18px;">
                  <div style="font-size:14px;font-weight:700;color:#263454;">🛡️&nbsp; Por seguridad, este enlace sólo puede usarse una vez.</div>
                  <div style="margin-top:5px;font-size:13px;line-height:1.45;color:#7b89ab;">Esto nos ayuda a mantener tu cuenta y tus datos protegidos.</div>
                </td></tr>
              </table>
              <div style="height:1px;margin:28px 0 20px;background:#dce1f0;"></div>
              <p style="margin:0;text-align:center;font-size:13px;line-height:1.5;color:#697795;">Si no realizaste esta solicitud, puedes ignorar este correo de forma segura.</p>
              <div style="height:1px;margin:22px 0 18px;background:#dce1f0;"></div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size:18px;font-weight:700;color:#17213d;"><span style="color:#5d45d8;">✦</span> Node<span style="font-weight:400;">Prox</span><div style="margin-top:3px;font-size:10px;font-weight:400;color:#7b89ab;">Construyendo un internet más abierto.</div></td>
                  <td align="right" style="font-size:10px;color:#7b89ab;">© 2026 NodeProx<br>Correo automático; no respondas a este mensaje.</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function passwordResetText(input: { resetUrl: string; expiresAt: Date }) {
  return `Solicitaste restablecer tu contraseña de NodeProx.

Continúa aquí: ${input.resetUrl}

Este enlace expira el ${input.expiresAt.toISOString()} y sólo puede usarse una vez.
Si no realizaste esta solicitud, puedes ignorar este correo.`;
}
