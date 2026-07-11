function o(e){return(e.bid+e.ask)/2}function i(e){let r=o(e);return(e.ask-e.bid)/r*1e4}function t(e,r){let n=i(e);if(n>r)throw new RangeError(`spread ${n.toFixed(1)}bps exceeds limit ${r}bps for ${e.symbol}`);return e}function u(){return[{symbol:"AAPL",bid:227.1,ask:227.12},{symbol:"ILLIQ",bid:4.1,ask:5.9}]}function s(e){return u().map(r=>t(r,e))}s(50);
//# sourceMappingURL=bundle.js.map
