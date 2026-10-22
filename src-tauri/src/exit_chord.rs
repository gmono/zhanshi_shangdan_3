pub(crate) fn is_exit_chord(
    key: u32,
    pressed: bool,
    control: bool,
    win: bool,
    alt: bool,
    shift: bool,
) -> bool {
    key == 0x51 && pressed && control && win && !alt && !shift
}

#[cfg(test)]
mod tests {
    use super::is_exit_chord;

    #[test]
    fn ctrl_win_q_pressed_requests_exit() {
        assert!(is_exit_chord(0x51, true, true, true, false, false));
    }

    #[test]
    fn incomplete_or_different_combinations_do_not_exit() {
        assert!(!is_exit_chord(0x51, true, false, true, false, false));
        assert!(!is_exit_chord(0x51, true, true, false, false, false));
        assert!(!is_exit_chord(0x41, true, true, true, false, false));
        assert!(!is_exit_chord(0x51, true, true, true, true, false));
        assert!(!is_exit_chord(0x51, true, true, true, false, true));
    }

    #[test]
    fn key_release_does_not_request_exit() {
        assert!(!is_exit_chord(0x51, false, true, true, false, false));
    }
}
