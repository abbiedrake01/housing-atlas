import {Component, type ReactNode} from 'react';

export default class ForecastBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
 state = {failed:false};

 static getDerivedStateFromError() {
  return {failed:true};
 }

 render() {
  if (this.state.failed) {
   return <div className="regression-page" role="alert">
    <p>The projections tab couldn’t load.</p>
    <button className="forecast-retry" onClick={()=>window.location.reload()}>Reload Housing Atlas</button>
   </div>;
  }
  return this.props.children;
 }
}
