import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '../shared/components/Pressable';
import type { Theme } from '../shared/theme';
import { useThemedStyles } from '../shared/theme-context';
import { reportError } from './crash-reporting';

type Props = { children: React.ReactNode };
type State = { failed: boolean };

// Last line of defence around the navigator: a render crash anywhere shows a
// calm screen instead of a white one, and «Перезапустить» remounts the tree.
export class AppErrorBoundary extends React.Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    reportError(error, { fatal: true });
  }

  private restart = () => this.setState({ failed: false });

  override render() {
    if (this.state.failed) return <CrashScreen onRestart={this.restart} />;
    return this.props.children;
  }
}

function CrashScreen({ onRestart }: { onRestart: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Что-то пошло не так</Text>
      <Text style={styles.body}>
        Мы уже получили отчёт об ошибке. Попробуйте перезапустить экран.
      </Text>
      <Pressable
        onPress={onRestart}
        accessibilityRole="button"
        accessibilityLabel="Перезапустить"
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>Перезапустить</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(4),
      paddingHorizontal: theme.spacing(8),
    },
    title: {
      color: theme.colors.text,
      fontSize: 20,
      fontWeight: '600',
      textAlign: 'center',
    },
    body: {
      color: theme.colors.muted,
      fontSize: 14,
      textAlign: 'center',
    },
    button: {
      paddingHorizontal: theme.spacing(5),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
    buttonText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: '600',
    },
  });
