let bcrypt = require('bcrypt')
const Failures = ({ location, msg, parameter, value, nestedErrors }) => {
	return {
		param: parameter,
		message: msg,
		nestedErrors: nestedErrors,
	};
};

const encriptPass=async(pass)=> {
	try {
		const saltOrRounds = 10;
		const password = pass;
		return await bcrypt.hash(password, saltOrRounds);
	} catch (error) {
		throw error
	}
}


const bcriptPass = async(old_password, user_pass)=> {
	try {
		return await bcrypt.compare(old_password, user_pass);
	} catch (error) {
		throw error
	}
}
const GenerateOtp =async()=>{
	try {
		let options = {
			length: 4,
			charset: "123456789",
		};
		let code = random_string.generate(options);
		let otp = `${code}`;
		return otp;
	} catch (error) {
		throw error;
	}
}

const genUniqueCode=async(count)=> {
	try {
		let options = {
			length: 7,
			charset: "alphanumeric",
		};
		let random_value = random_string.generate(options);

		// fetch users count

		let inc_value = Number(count) + 1;

		// unique code
		let unique_code = `${random_value}${inc_value}`;
		return unique_code;
	} catch (err) {
		throw err;
	}
};


module.exports = {
	 Failures,
	 encriptPass,
	 bcriptPass,
	 genUniqueCode,
	 GenerateOtp
	};