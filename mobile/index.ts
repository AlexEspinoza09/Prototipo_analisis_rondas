import { registerRootComponent } from 'expo';

// Defining the background task must happen at module load, before the app mounts.
import './src/tracking/locationTask';

import App from './src/App';

registerRootComponent(App);
