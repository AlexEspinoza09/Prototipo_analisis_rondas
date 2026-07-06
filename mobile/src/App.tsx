import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ScanResult } from './api/types';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { PatrolProvider, usePatrol } from './patrol/PatrolContext';
import { ActivePatrolScreen } from './screens/ActivePatrolScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { RoutesScreen } from './screens/RoutesScreen';
import { ScanResultScreen } from './screens/ScanResultScreen';
import { ScanScreen } from './screens/ScanScreen';

export type RootStackParamList = {
  Login: undefined;
  Routes: undefined;
  ActivePatrol: undefined;
  Scan: undefined;
  ScanResult: { result: ScanResult };
  History: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigator() {
  const { user, loading: authLoading } = useAuth();
  const { patrol, loading: patrolLoading } = usePatrol();

  if (authLoading || patrolLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontSize: 16 } }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          {patrol ? (
            <Stack.Screen
              name="ActivePatrol"
              component={ActivePatrolScreen}
              options={{ title: 'Ronda en curso', headerBackVisible: false }}
            />
          ) : (
            <Stack.Screen
              name="Routes"
              component={RoutesScreen}
              options={{ title: 'Rutas disponibles' }}
            />
          )}
          <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Escanear QR' }} />
          <Stack.Screen
            name="ScanResult"
            component={ScanResultScreen}
            options={{ title: 'Resultado', headerBackVisible: false }}
          />
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ title: 'Historial de rondas' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PatrolProvider>
          <NavigationContainer>
            <StatusBar style="dark" />
            <Navigator />
          </NavigationContainer>
        </PatrolProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
