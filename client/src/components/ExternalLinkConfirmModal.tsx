import { Modal } from "./Modal";
import { NavIcon, type NavIconName } from "./NavIcons";

// Куда ведут кнопки-подтверждения: Boosty открывается в браузере пользователя,
// Telegram — сначала в установленном клиенте (tg://), при его отсутствии — в
// браузере (см. openExternalLink / openTelegramLink в electronApi.ts).
export const BOOSTY_URL = "https://boosty.to/tofu_bro";
export const TELEGRAM_WEB_URL = "https://t.me/brothertofu";

interface ExternalLinkConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  icon: NavIconName;
  onClose: () => void;
  onConfirm: () => void;
}

// Подтверждение перед уходом на внешний ресурс: переход случается только по
// явному согласию. Модалка собрана в зинной системе design_revision.md:
// плашка-инверсия называет её (§1.4), капс-подпись шрифтом Label, проза —
// обычной гарнитурой (§1.5), акцентный бюджет — ровно одна кнопка (§1.8).
export function ExternalLinkConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  icon,
  onClose,
  onConfirm,
}: ExternalLinkConfirmProps) {
  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="external-confirm">
        <div className="external-confirm__head" role="heading" aria-level={2}>
          <NavIcon name={icon} />
          <span>{title}</span>
        </div>
        <p className="external-confirm__text">{message}</p>
        <div className="external-confirm__actions">
          <button type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}