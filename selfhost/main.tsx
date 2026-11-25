import {createRoot} from 'react-dom/client';
import PrismApp from '../components/prism/app';
import '../app/globals.css';
import '../app/workspace.css';
createRoot(document.getElementById('root')!).render(<PrismApp/>);
