// Copyright (c) 2014, Bitquant Research Laboratories (Asia) Ltd.
// Licensed under the Simplified BSD License
"use strict";
if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define(["moment", "./YEARFRAC"], function(moment, YEARFRAC) {
function LoanCalculator() {
    this.events = {};
    this.event_list = [];
    this.current_event = 0;
}

LoanCalculator.prototype.test_wrapper = function() {
    console.log("Hello world");
};

LoanCalculator.prototype.add_to_event_table = function(func) {
    var o = this;
    return function(param) {
	var on = param["on"];
	if (!(on in o.events)) {
	    if (o.event_list.length > 0 && 
		on < o.event_list[o.current_event]) {
		throw "Event already past" + o.event_list[o.current_event];
	    }
	    o.event_list.push(on);
	    o.event_list = o.event_list.sort(function(a, b) {
		return new Date(a) - new Date(b);
	    });
	    o.events[on] = [];
	}
	if (param.prepend === "true") {
	    o.events[on].unshift(function() { return func(o, param); });
	} else {
	    o.events[on].push(function() { return func(o, param); });
	}
    };
}

LoanCalculator.prototype.run_events = function(term_sheet) {
    var payment_schedule = [];
    this.currency = term_sheet.currency;
    this.principal = 0.0;
    this.balance = 0.0;
    this.current_event = 0;
    var prev_date = undefined;
    while (this.current_event < this.event_list.length) {
	var k = this.event_list[this.current_event];
	var i = this.events[k];
        if (prev_date !== undefined) {
            var interest = this.compounding_factor(prev_date,
					       k) * this.balance;
            this.balance = this.balance + interest;
	    this.balance = Number(this.balance.toFixed("2"));
	}
        i.forEach(function(j){
            var payment = j();
            if (payment === undefined) {
		return;
	    } else if (payment.constructor === Array) {
		payment.forEach(function(i) {
		    payment_schedule.push(payment);
		}
			       );
	    } else {
                payment_schedule.push(payment);
	    }
	});
        prev_date = k;
	this.current_event++;
    }
    return payment_schedule;
}

LoanCalculator.prototype.show_payments = function(term_sheet) {
    var obj = this;
    var payment_schedule = this.calculate(term_sheet);
    var lines = [["type", "payment", "beginning principal",
		"interest", "end_balance"]];
    payment_schedule.forEach (function(i) {
	Array.prototype.push.apply(lines,
				   obj.term_sheet.process_payment(obj, i));
    }
			     );
    return lines;
}

LoanCalculator.prototype.show_payment = function(i) {
    var line = [];
    line.push([i["event"], i["on"], i.payment,
                   i["principal"], i["interest_accrued"],
                    i["balance"]]);
    
    if(i['note'] != undefined) {
        line.push(["  ", i['note']]);
    }
    return line;
}

LoanCalculator.prototype.calculate = function(term_sheet) {
    this.term_sheet = term_sheet;
    term_sheet.payments(this);
    return this.run_events(term_sheet);
}

LoanCalculator.prototype.extract_payment = function(params) {
    var payment;
    if (params.hasOwnProperty("amount")) {
	payment = params.amount;
    } else {
	payment = params;
    }
    if (typeof(payment) == "function") {
	payment = payment();
    } 
    if (payment.hasOwnProperty("amount")) {
	payment = payment.amount;
    }
    if (payment.hasOwnProperty("toNumber")) {
	payment = payment.toNumber();
    }
    return payment;
}

LoanCalculator.prototype.fund = function(params) {
    var _fund = function(o, params) {
	var payment = o.extract_payment(params);
	var principal = o.principal;
	var interest_accrued = o.balance - o.principal;
	o.balance = o.balance + payment;
	o.principal = o.principal + payment;
        return {"event":"Funding",
                "on":params.on,
                "payment":payment,
                "principal": o.principal,
                "interest_accrued": interest_accrued,
                "balance":o.balance,
                "note":params.note};
    }
    this.add_to_event_table(_fund)(params);
}

var _payment = function(o, params) {
    var payment = o.extract_payment(params);
    var principal = o.principal;
    var interest_accrued = o.balance - o.principal;
    if (payment > o.balance) {
        payment = o.balance;
    }
    if (payment >  (o.balance-o.principal)) {
        o.principal = o.principal - (payment - o.balance + o.principal);
    }
    o.balance = o.balance - payment;
    if (payment > 0) {
        return {"event":"Payment",
                "on":params.on,
                "payment":payment,
                "principal":principal,
                "interest_accrued": interest_accrued,
                "balance":o.balance,
                "note":params.note}
    }
}

LoanCalculator.prototype.payment = function(params) {
    this.add_to_event_table(_payment)(params);
}

LoanCalculator.prototype.add_to_balance = function(params) {
    var _payment = function(o, params) {
	var payment = o.extract_payment(params);
        o.balance = o.balance + payment;
        if (payment > 0) {
            return {"event":"Payment",
                    "on":params.on,
                    "payment":payment,
                    "principal": o.principal,
                    "interest_accrued": 0.0,
                    "balance":o.balance,
                    "note":params.note}
	}
    }
    this.add_to_event_table(_payment)(params);
}

LoanCalculator.prototype.amortize = function(params) {
    if (params.payment_func === undefined) {
	params.payment_func = _payment;
    }
    var _amortize = function(o, params) {
	var p = o.extract_payment(params);
	var npayments = params.payments;
	var on = params.on;
	var forward_date = 
	    o.add_duration(on, params.interval);
	var payment = o.compounding_factor(on, forward_date) / 
	    (1.0 - Math.pow(1 + o.compounding_factor(on, forward_date), 
			    -npayments)) * p
	var d = forward_date;
	for (var i=0; i < npayments; i++) {
	    o.add_to_event_table(params.payment_func)({"on":d, 
						       "amount" : payment, 
						       "note" : params.note,
						       "prepend" : "true"});
	    d = o.add_duration(d, params.interval);
	}
    }
    this.add_to_event_table(_amortize)(params);
}

LoanCalculator.prototype.compounding_factor = function(from_date,
					    to_date) {
    var yearfrac = this.year_frac(from_date, to_date);
    var periods = yearfrac * this.term_sheet.compound_per_year;
    return Math.pow((1.0 + this.term_sheet.annual_interest_rate / 
		    this.term_sheet.compound_per_year), periods) - 1.0;
}

LoanCalculator.prototype.add_duration = function (date,
						  duration) {
    var d = moment(date);
    d.add.apply(d, duration);
    return d.toDate();
}

LoanCalculator.prototype.interest = function(from_date, to_date,
						  amount) {
    var obj = this;
    return function() {
	return obj.compounding_factor(from_date, to_date) * amount();
    }
}

LoanCalculator.prototype.year_frac = function(from_date,
					      to_date) {
    if (this.term_sheet.day_count_convention === "30/360US") {
	return YEARFRAC.YEARFRAC(from_date, to_date, 0);
    } else if (this.term_sheet.day_count_convention === "Actual/Actual") {
	return YEARFRAC.YEARFRAC(from_date, to_date, 1);
    } else if (this.term_sheet.day_count_convention === "Actual/360") {
	return YEARFRAC.YEARFRAC(from_date, to_date, 2);
    } else if (this.term_sheet.day_count_convention === "Actual/365") {
	return YEARFRAC.YEARFRAC(from_date, to_date, 3);
    } else if (this.term_sheet.day_count_convention === "30/360EUR") {
	return YEARFRAC.YEARFRAC(from_date, to_date, 4);
    } else {
	throw "unknown day count convention";
    }
}

LoanCalculator.prototype.remaining_principal = function() {
    var o = this;
    return function() { return o.principal; }
}

LoanCalculator.prototype.accrued_interest = function() {
    var o = this;
    return function() { return (o.balance - o.principal); }
}

LoanCalculator.prototype.remaining_balance = function() {
    var o = this;
    return function() { return(o.balance); }
}

LoanCalculator.prototype.multiply = function (a, b) {
    var o = this;
    return function() { return o.extract_payment(a) * b };
}
return {"LoanCalculator":LoanCalculator};
});
